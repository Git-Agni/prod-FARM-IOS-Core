/** Instagram accounts the release flow is calibrated for (Antonio, Oct 30: post @antoniomonteiroai Trial Reels with
 * linked Facebook sharing, on its own times, without touching @antoniorevenue). One phone, one Instagram app: a release
 * for another account switches the app there and leaves it on the default account again afterwards. */
import type { PostingInput } from './model.js';

export interface PostingAccount {
    instagram: string;
    /** The Facebook target account string a calendar item must carry for linked sharing. */
    facebookUrl: string;
    /** Graph Page id for tap-free receipts; undefined means the 1Password Antonio Revenue Page. */
    facebookPageId?: string;
    /** The "Also share on" row label when sharing to this account's Page is on. */
    facebookComposerLabel: string;
    /** The in-app Facebook check is mapped only for the Antonio Revenue Page; others rely on the Graph receipt. */
    facebookAppCheck: boolean;
}

export const DEFAULT_INSTAGRAM_ACCOUNT = 'antoniorevenue';
export const POSTING_ACCOUNTS: Record<string, PostingAccount> = {
    antoniorevenue: {
        instagram: 'antoniorevenue', facebookUrl: 'https://www.facebook.com/profile.php?id=61584693917444',
        facebookComposerLabel: 'Antonio Revenue, Facebook · Public, On', facebookAppCheck: true,
    },
    antoniomonteiroai: {
        instagram: 'antoniomonteiroai', facebookUrl: 'https://www.facebook.com/1335852916285633', facebookPageId: '1335852916285633',
        facebookComposerLabel: 'Antonio Monteiro AI, Facebook · Public, On', facebookAppCheck: false,
    },
};

export const instagramAccountOf = (input: Pick<PostingInput, 'targets'>) =>
    input.targets.find(t => t.platform === 'instagram')?.account.replace(/^@/, '').toLowerCase();

/** True for an Instagram item on a calibrated account other than @antoniorevenue. Such items keep their armed time:
 * the antoniorevenue lane tools (slotter, backlog, related-Reel linking) leave them alone. */
export const isSecondaryAccount = (input: Pick<PostingInput, 'targets'>) => {
    const account = instagramAccountOf(input);
    return !!account && account !== DEFAULT_INSTAGRAM_ACCOUNT;
};

export function postingAccountFor(input: Pick<PostingInput, 'targets'>): PostingAccount {
    const account = POSTING_ACCOUNTS[instagramAccountOf(input) ?? ''];
    if (!account) throw new Error('Instagram account is not calibrated');
    const facebook = input.targets.find(t => t.platform === 'facebook');
    // antoniorevenue keeps its existing behavior; a new account must name its own Page exactly.
    if (facebook && account.instagram !== DEFAULT_INSTAGRAM_ACCOUNT && facebook.account !== account.facebookUrl) throw new Error(`Facebook destination ${facebook.account} is not the linked Page of @${account.instagram}`);
    return account;
}
