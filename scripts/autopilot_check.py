#!/usr/bin/env python3
"""Check the existing Phone Farm worker without AI, phone input or another schedule.
The TypeScript worker owns publication. This script never imports, shares, arms,
reschedules or clears claims. Use --watch for a quiet local status file.
"""
import argparse
import collections
import datetime as dt
import json
import pathlib
import time
import urllib.request

BASE = 'http://127.0.0.1:3000/api/publishing'

def read(path):
    with urllib.request.urlopen(BASE + path, timeout=15) as response:
        return json.load(response)

def inspect():
    caps, cadence = read('/capabilities'), read('/cadence')
    releases = {r['item_id']: r for r in read('/releases').get('releases', [])}
    items, offset, seen_offsets = {}, 0, set()
    while offset is not None:
        if offset in seen_offsets or len(seen_offsets) >= 200:
            raise RuntimeError('Calendar pagination did not finish')
        seen_offsets.add(offset)
        page = read('/items?limit=100&offset=' + str(offset))
        items.update({i['id']: i for i in page.get('items', [])})
        offset = page.get('nextOffset')
    enabled = set(caps.get('direct', {}).get('itemIds', []))
    now = dt.datetime.now(dt.timezone.utc)
    groups, issues = collections.defaultdict(list), []
    for item in items.values():
        if item['status'] == 'cancelled':
            continue
        groups[(item['input']['deviceUdid'], item['media']['sha256'])].append(item)
        release = releases.get(item['id'], {})
        if item['status'] == 'published':
            continue
        reasons = []
        if release.get('share_claimed_at') or item['status'] in ('needs_review', 'publishing'):
            reasons.append('Inspect the existing submission; do not retry')
        if item.get('results', {}).get('hourlyRecoveryExclusion') or item.get('results', {}).get('externalYouTubeDelivery'):
            reasons.append('Existing delivery or duplicate review')
        if release.get('state') != 'armed':
            reasons.append('Not armed')
        elif release.get('item_version') != item['version']:
            reasons.append('Release version does not match')
        if caps.get('controlMode') == 'wda' and item['id'] not in enabled:
            reasons.append('Not enabled for the worker')
        for target in item['input']['targets']:
            platform = target['platform']
            if caps.get('platforms', {}).get(platform, {}).get('ready') is not True:
                reasons.append(platform + ' native flow needs review')
        if dt.datetime.fromisoformat(item['input']['runAt'].replace('Z', '+00:00')) < now:
            reasons.append('Calendar time passed')
        if reasons:
            issues.append({'itemId': item['id'], 'video': item['media']['name'],
                           'platforms': [t['platform'] for t in item['input']['targets']],
                           'runAt': item['input']['runAt'], 'reasons': list(dict.fromkeys(reasons))})
    return {'checkedAt': now.isoformat(), 'usesAI': False, 'scheduleOwner': 'phone_farm_worker',
            'workerHealthy': cadence.get('runtime', {}).get('healthy') is True,
            'fullAutopilotReady': not issues and all(caps.get('platforms', {}).get(p, {}).get('ready') is True for p in ('instagram','facebook','youtube','tiktok')),
            'counts': {'items': len(items), 'videoGroups': len(groups),
                       'publishedItems': sum(i['status'] == 'published' for i in items.values()),
                       'itemsWithBlockers': len(issues)}, 'issues': issues}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--watch', action='store_true')
    parser.add_argument('--interval', type=int, default=300)
    parser.add_argument('--output', type=pathlib.Path)
    args = parser.parse_args()
    if args.interval < 30:
        parser.error('Use an interval of at least 30 seconds')
    if args.watch and not args.output:
        parser.error('--watch requires --output for a quiet local report')
    while True:
        try:
            result = inspect()
        except Exception as error:
            result = {'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                      'usesAI': False, 'fullAutopilotReady': False, 'error': str(error)}
        payload = json.dumps(result, indent=2) + '\n'
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            temporary = args.output.with_suffix(args.output.suffix + '.tmp')
            temporary.write_text(payload)
            temporary.replace(args.output)
        if not args.watch:
            print(payload, end='')
            return
        time.sleep(args.interval)

if __name__ == '__main__':
    main()
