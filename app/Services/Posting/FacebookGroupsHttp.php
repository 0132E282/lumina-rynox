<?php

declare(strict_types=1);

namespace App\Services\Posting;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Reads the joined groups by replaying Facebook's own pagination GraphQL with the saved web session (no browser launched).
 * ! Session tokens and response bodies never go into messages or logs.
 */
final class FacebookGroupsHttp
{
    private const MAX_PAGES = 12;

    private const JOINS_URL = 'https://www.facebook.com/groups/joins/?nav_source=tab';

    private const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

    public function __construct(private readonly FacebookWebSession $session = new FacebookWebSession) {}

    /**
     * @return array{status: 'ok', groups: list<array{id: string, name: string, url: string, image: string|null}>}|array{status: 'failed', error: string}
     */
    public function fetch(): array
    {
        $session = $this->session->loadGroups();

        if ($session === null) {
            return ['status' => 'failed', 'error' => 'no_session'];
        }

        $template = $session['groups_template'];
        $session = $this->withFreshTokens($session);
        $groups = [];
        $cursor = null;

        for ($page = 0; $page < self::MAX_PAGES; $page++) {
            $variables = $template['variables'] + ($cursor === null ? [] : ['cursor' => $cursor]);

            try {
                $response = Http::asForm()->timeout(30)->withHeaders([
                    'Cookie' => $session['cookie_header'],
                    'User-Agent' => self::USER_AGENT,
                    'Origin' => 'https://www.facebook.com',
                    'Referer' => 'https://www.facebook.com/groups/joins/',
                    'Sec-Fetch-Site' => 'same-origin',
                    'Sec-Fetch-Mode' => 'cors',
                    'X-FB-LSD' => $session['lsd'],
                    'X-FB-Friendly-Name' => $template['params']['fb_api_req_friendly_name'] ?? '',
                ])->post(FacebookWebSession::GRAPHQL_URL, $template['params'] + [
                    'av' => $session['user_id'],
                    '__user' => $session['user_id'],
                    'fb_dtsg' => $session['fb_dtsg'],
                    'lsd' => $session['lsd'],
                    'jazoest' => $session['jazoest'],
                    'variables' => json_encode($variables),
                ]);
            } catch (ConnectionException) {
                return ['status' => 'failed', 'error' => 'timeout'];
            }

            $json = json_decode((string) preg_replace('/^for \(;;\);/', '', strtok($response->body(), "\n") ?: ''), true);
            $connection = is_array($json) ? ($json['data']['viewer']['all_joined_groups']['tab_groups_list'] ?? null) : null;

            if (! is_array($connection)) {
                // * A later page failing keeps what was read; only the first page is a hard failure.
                return $page === 0 ? ['status' => 'failed', 'error' => 'expired'] : ['status' => 'ok', 'groups' => array_values($groups)];
            }

            foreach ((array) ($connection['edges'] ?? []) as $edge) {
                $group = $this->node($edge['node'] ?? null);

                if ($group !== null) {
                    $groups[$group['id']] = $group;
                }
            }

            $info = (array) ($connection['page_info'] ?? []);
            $cursor = is_string($info['end_cursor'] ?? null) ? $info['end_cursor'] : null;

            if (($info['has_next_page'] ?? false) !== true || $cursor === null) {
                break;
            }

            usleep(300_000);
        }

        return ['status' => 'ok', 'groups' => array_values($groups)];
    }

    /**
     * The tokens saved earlier go stale; the joins page a browser would open first carries current ones, so one GET renews them. Any failure keeps the saved tokens.
     *
     * @param  array{user_id: string, fb_dtsg: string, lsd: string, jazoest: string, cookie_header: string, groups_template: array<string, mixed>}  $session
     * @return array{user_id: string, fb_dtsg: string, lsd: string, jazoest: string, cookie_header: string, groups_template: array<string, mixed>}
     */
    private function withFreshTokens(array $session): array
    {
        try {
            $html = Http::timeout(30)->withHeaders([
                'Cookie' => $session['cookie_header'],
                'User-Agent' => self::USER_AGENT,
                'Accept' => 'text/html,application/xhtml+xml',
                'Accept-Language' => 'vi-VN,vi;q=0.9',
                'Sec-Fetch-Dest' => 'document',
                'Sec-Fetch-Mode' => 'navigate',
                'Sec-Fetch-Site' => 'none',
            ])->get(self::JOINS_URL)->body();
        } catch (ConnectionException) {
            return $session;
        }

        $dtsg = preg_match('/"DTSGInitialData",\[\],\{"token":"([^"]+)"/', $html, $dtsgMatch) === 1 ? $dtsgMatch[1] : null;
        $lsd = preg_match('/"LSD",\[\],\{"token":"([^"]+)"/', $html, $lsdMatch) === 1 ? $lsdMatch[1] : null;

        if ($dtsg === null || $lsd === null) {
            return $session;
        }

        // * Facebook's own rule: "2" followed by the sum of the character codes of fb_dtsg.
        return [...$session, 'fb_dtsg' => $dtsg, 'lsd' => $lsd, 'jazoest' => '2'.array_sum(array_map('ord', str_split($dtsg)))];
    }

    /** @return array{id: string, name: string, url: string, image: string|null}|null */
    private function node(mixed $node): ?array
    {
        if (! is_array($node) || ! is_string($node['id'] ?? null) || ! is_string($node['name'] ?? null)) {
            return null;
        }

        $image = null;

        foreach (['profile_picture', 'group_profile_picture', 'profile_picture_48'] as $key) {
            if (is_string($node[$key]['uri'] ?? null)) {
                $image = $node[$key]['uri'];
                break;
            }
        }

        $url = is_string($node['url'] ?? null) ? $node['url'] : 'https://www.facebook.com/groups/'.$node['id'].'/';

        return ['id' => $node['id'], 'name' => $node['name'], 'url' => $url, 'image' => $image];
    }
}
