<?php

declare(strict_types=1);

namespace App\Services\Posting;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Creates a public text post on the personal LinkedIn feed by replaying the web app's own `CreatePost` request
 * (`flagship-web/rsc-action`) over HTTP, signed in with the browser cookie from `posting.linkedin_personal.web_cookie`.
 * ! Unofficial and against LinkedIn's terms on automation: the account may be restricted. The request shape was copied from the
 * ! live composer; the headers beyond cookie and csrf-token are UNVERIFIED. The cookie is only sent to linkedin.com and is never logged.
 */
final class LinkedInWebClient
{
    private const ENDPOINT = 'https://www.linkedin.com/flagship-web/rsc-action/actions/server-request';

    private const REQUEST_ID = 'com.linkedin.sdui.requests.sharing.CreatePost';

    private const SCREEN_ID = 'com.linkedin.sdui.flagshipnav.sharing.ShareCompose';

    private const TIMEOUT_SECONDS = 30;

    // * state key => [payload field, plain value]; the post text is added separately because its value is a TextModel.
    private const STATES = [
        'ShareBoxdetourType' => ['detourType', 'Text', 'stringValue'],
        'ShareBoxcollectionRefBinding' => ['collectionRefBinding', 'mainFeed', 'stringValue'],
        'ShareBoxshareOriginBinding' => ['shareOrigin', '', 'stringValue'],
        'ShareBoxnbaProfileEntityUrnBinding' => ['nbaProfileEntityUrnString', '', 'stringValue'],
        'ShareBoxsourceReferenceBinding' => ['sourceReference', '', 'stringValue'],
        'ShareBoxshareLifeCycleState' => ['shareLifeCycleState', 'ShareLifeCycleState_PUBLISHED', 'stringValue'],
        'ShareBoxselectedVisibilitySettingString' => ['visibilityType', 'Anyone', 'stringValue'],
        'ShareBoxselectedCommentControl' => ['commentControlType', 'Anyone', 'stringValue'],
        'ShareBoxselectedActor' => ['actorContext', 'Self', 'stringValue'],
        'ShareBoxselectedGroup' => ['groupId', '-1', 'stringValue'],
        'ShareBoxscheduledPublishTime' => ['scheduledPublishTime', ['type' => 'bigint', 'value' => '0'], 'signedLongValue'],
        'ShareBoxbrandPartnerEnable' => ['paidEndorsement', false, 'booleanValue'],
        'ShareBoxparentUrnBinding' => ['parentUrnString', '', 'stringValue'],
        'ShareBoxmediaUrnBinding' => ['mediaUrnString', '', 'stringValue'],
        'ShareBoxshareboxSessionUrn' => ['shareboxSessionUrn', null, 'stringValue'],
        'ShareBoxautoSaveComposerGeneration' => ['autoSaveGeneration', 2, 'expression'],
        'ShareBoxshareBoxMode' => ['shareBoxMode', 'Create', 'stringValue'],
        'ShareBoxgifUrl' => ['gifOriginalUrl', '', 'stringValue'],
        'media-creation-editor-hasAltTextChanged' => ['hasVideoAltTextChanged', false, 'booleanValue'],
        'ShareBoxrepostingThreadUrnBinding' => ['repostingThreadUrnString', '', 'stringValue'],
        'ShareBoxcollaborators' => ['collaboratorUrns', [], 'stringListValue'],
    ];

    // * Requested by the composer but never given a value.
    private const UNSET_STATES = [
        'media-creation-editor-newAltText' => 'videoAltText',
        'PagesTargetAudienceLanguage-selectedCriteriaIds' => 'languageIds',
        'PagesTargetAudienceRegion-selectedCriteriaIds' => 'regionIds',
        'PagesTargetAudienceLocation-selectedCriteriaIds' => 'locationIds',
        'PagesTargetAudienceFunction-selectedCriteriaIds' => 'functionIds',
        'PagesTargetAudienceSchool-selectedCriteriaIds' => 'organizationIds',
        'PagesTargetAudienceCompanySize-selectedCriteriaIds' => 'companySizeIds',
        'PagesTargetAudienceSeniority-selectedCriteriaIds' => 'seniorityIds',
        'PagesTargetAudienceIndustry-selectedCriteriaIds' => 'industryIds',
    ];

    private const TEXT_KEY = 'ShareBoxrichCommentaryTextMemoryBinding';

    /** True when the cookie string holds both values the request needs and nothing that could split a header. */
    public static function usable(?string $cookie): bool
    {
        return is_string($cookie)
            && preg_match('/[\r\n]/', $cookie) !== 1
            && str_contains($cookie, 'li_at=')
            && self::csrfToken($cookie) !== null;
    }

    /**
     * @return array{status: 'ok'|'rejected'|'unknown', url: string|null, post_id: string|null}
     */
    public function publishText(string $text, string $cookie): array
    {
        $csrf = self::csrfToken($cookie);

        if ($csrf === null) {
            return ['status' => 'rejected', 'url' => null, 'post_id' => null];
        }

        try {
            $response = Http::timeout(self::TIMEOUT_SECONDS)
                ->connectTimeout(5)
                ->withoutRedirecting()
                ->withHeaders([
                    'Cookie' => $cookie,
                    'csrf-token' => $csrf,
                    'Accept' => '*/*',
                    'Origin' => 'https://www.linkedin.com',
                    'Referer' => 'https://www.linkedin.com/feed/',
                    'User-Agent' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                ])
                ->withBody(json_encode($this->body($text), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'application/json')
                ->post(self::ENDPOINT.'?'.http_build_query(['sduiid' => self::REQUEST_ID, 'parentSpanId' => base64_encode(random_bytes(8))]));
        } catch (ConnectionException) {
            return ['status' => 'unknown', 'url' => null, 'post_id' => null];
        }

        // * Not signed in, a stale csrf token or a refused request: nothing was posted.
        if (in_array($response->status(), [301, 302, 303, 307, 308, 400, 401, 403, 404, 422, 429], true)) {
            return ['status' => 'rejected', 'url' => null, 'post_id' => null];
        }

        if (! $response->successful()) {
            return ['status' => 'unknown', 'url' => null, 'post_id' => null];
        }

        // * The answer format is not documented: only a post id found in it counts as proof the post exists.
        $postId = preg_match('/urn:li:(?:activity|share|ugcPost):\d{5,30}/', $response->body(), $match) === 1 ? $match[0] : null;

        return $postId === null
            ? ['status' => 'unknown', 'url' => null, 'post_id' => null]
            : ['status' => 'ok', 'url' => 'https://www.linkedin.com/feed/update/'.$postId.'/', 'post_id' => $postId];
    }

    private static function csrfToken(string $cookie): ?string
    {
        if (preg_match('/(?:^|;\s*)JSESSIONID="?([^";]+)"?/', $cookie, $match) !== 1) {
            return null;
        }

        return $match[1];
    }

    /** @return array<string, mixed> */
    private function body(string $text): array
    {
        $sessionUrn = 'urn:li:shareboxSession:'.base64_encode(random_bytes(16));
        $payload = [];
        $states = [[
            'key' => self::TEXT_KEY,
            'namespace' => 'MemoryNamespace',
            'value' => ['text' => $text, 'attribute' => [], '$type' => 'TextModel', 'source' => 'local'],
            'originalProtoCase' => 'textModelForWrite',
            'protoKey' => $this->protoKey(self::TEXT_KEY),
        ]];
        $keys = [self::TEXT_KEY];
        $payload['richCommentaryTextBinding'] = $this->binding(self::TEXT_KEY);

        foreach (self::STATES as $key => [$field, $value, $protoCase]) {
            $keys[] = $key;
            $payload[$field] = $this->binding($key);
            $states[] = [
                'key' => $key,
                'namespace' => 'MemoryNamespace',
                'value' => $key === 'ShareBoxshareboxSessionUrn' ? $sessionUrn : $value,
                'originalProtoCase' => $protoCase,
                'protoKey' => $this->protoKey($key),
            ];
        }

        foreach (self::UNSET_STATES as $key => $field) {
            $keys[] = $key;
            $payload[$field] = $this->binding($key);
        }

        $arguments = [
            '$type' => 'proto.sdui.actions.requests.RequestedArguments',
            'requestedStateKeys' => array_map(fn (string $key): array => ['key' => ['value' => ['$case' => 'id', 'id' => $key]]], $keys),
            'payload' => $payload,
            'requestMetadata' => [
                '$type' => 'proto.sdui.common.RequestMetadata',
                'currentActor' => [
                    '$type' => 'proto.sdui.bindings.core.Bindable',
                    'key' => ['key' => ['value' => ['$case' => 'id', 'id' => 'ShareBoxselectedActor']], 'namespace' => ''],
                    'content' => ['$case' => 'stringBinding', 'stringBinding' => (object) []],
                ],
            ],
        ];

        return [
            'requestId' => self::REQUEST_ID,
            'serverRequest' => [
                'requestId' => self::REQUEST_ID,
                'requestedArguments' => $arguments,
                'isApfcEnabled' => false,
                'isStreaming' => false,
                'rumPageKey' => '',
            ],
            'states' => $states,
            'requestedArguments' => $arguments + ['states' => $states, 'screenId' => self::SCREEN_ID, 'knownTemplateIds' => []],
        ];
    }

    /** @return array{key: string, namespace: string} */
    private function binding(string $key): array
    {
        return ['key' => $key, 'namespace' => 'MemoryNamespace'];
    }

    /** @return array<string, mixed> */
    private function protoKey(string $key): array
    {
        return ['$type' => 'proto.sdui.Key', 'value' => ['$case' => 'id', 'id' => $key]];
    }
}
