import { readFileSync } from 'node:fs';
import { Zalo } from 'zca-js';
import { loadConfig } from './config.mjs';
import { createLaravelClient } from './laravel-client.mjs';
import { createLogger } from './logger.mjs';
import { createBridgeServer } from './server.mjs';
import { SessionManager } from './session-manager.mjs';
import { ZaloSession } from './zalo-session.mjs';

const logger = createLogger();

let config;
try {
    config = loadConfig();
} catch (error) {
    logger.log('config_invalid', error.message);
    process.exit(1);
}

const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const laravel = createLaravelClient({
    baseUrl: config.callbackUrl,
    secret: config.secret,
    logger,
});
// logging:false để zca-js không in log; checkUpdate:false để không gọi registry.npmjs.org.
// Mỗi tài khoản một ZaloSession + một client Laravel gắn khoá tài khoản; QR chưa có khoá (bind sau khi đăng nhập).
const session = new SessionManager({
    createSession: (accountKey, onLoggedIn) =>
        new ZaloSession({
            createZalo: () => new Zalo({ logging: false, checkUpdate: false }),
            laravel: laravel.forAccount(accountKey),
            logger,
            sendGapMs: config.sendGapMs,
            onLoggedIn,
        }),
    laravel,
    logger,
});
const bridge = createBridgeServer({
    session,
    secret: config.secret,
    logger,
    version,
});

try {
    await bridge.listen(config.port, config.host);
} catch (error) {
    logger.log('listen_failed', error.code ?? 'listen_failed');
    process.exit(1);
}
logger.log('listening', `${config.host}:${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        session.shutdown();
        await bridge.close();
        process.exit(0);
    });
}

void session.bootstrap();
