/** Story script from a Reel caption, on the Full Visual kit's script rules (Antonio, Oct 20: apply the kit's script and
 * editing principles to Story sequences). The caption is already the approved script, so nothing is invented: the kit's
 * arc is rebuilt from the caption's own sentences plus fixed glue lines. Hook = the sentence that best passes the kit's
 * hook tests; then the mechanism in caption order; a re-hook ("And the best part?") before the last point; the turn (the
 * caption's short pattern line); a call to action that names what arrives. */
import { captionSentences } from './story-lifestyle.js';

export interface StoryScript { hook: string; points: string[]; turn?: string; cta: string; keyword?: string; reward?: string }

export const HOOK_PASS = 6;
const NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion)\b/i;
const words = (s: string) => s.trim().split(/\s+/);

/** The kit's five hook tests, 0 to 2 each (10 max): a real named thing in the first four words, a side or a direct
 * address, something concrete (a number), a promise of payoff, and complete within about 16 words. A question with no
 * number and no name scores 0. */
export function hookScore(s: string): number {
    const w = words(s), first4 = w.slice(0, 4);
    // "Your leads" is the viewer's own thing, which the kit counts as a known real thing.
    const named = first4.some((x, i) => (i > 0 && /^[A-Z][A-Za-z0-9]/.test(x)) || /[a-z][A-Z]|[A-Z]{2,}/.test(x) || /^your$/i.test(x));
    const viewer = /\b(you|your|you're|you'll)\b/i.test(s);
    const number = NUMBER.test(s);
    if (s.trim().endsWith('?') && !number && !named) return 0;
    const promise = /\b(free|open[- ]source|better|faster|than|until|why|how|before|instead)\b/i.test(s);
    const length = w.length <= 16 ? 2 : w.length <= 22 ? 1 : 0;
    return (named ? 2 : 0) + (viewer ? 2 : 0) + (number ? 2 : 0) + (promise ? 2 : 0) + length;
}

/** "Comment MIMIC and I'll send you the setup guide." -> keyword MIMIC, reward "the setup guide". */
export function ctaParts(caption: string): { keyword?: string; reward?: string } {
    const m = caption.match(/\bComment\s+["“']?([A-Z][A-Z0-9]{1,19})["”']?([^\n]*)/);
    if (!m) return {};
    const reward = m[2]!.match(/\b(?:send you|get)\s+([^.!\n]{3,60})/i)?.[1]?.trim();
    return { keyword: m[1], ...(reward ? { reward } : {}) };
}

/** A turn names the pattern in a few words ("Style is the new edge.", "You learn by doing."). */
const isTurn = (s: string) => words(s).length <= 9 && !/^(follow|setup|see)\b/i.test(s);

export function storyScript(caption: string): StoryScript | null {
    // A short lead-in ("Harvard Business Review studied this.") joins the sentence it sets up: one idea per frame, with
    // its reason inside it.
    const s: string[] = [];
    // A sentence that starts lowercase is a list item ("the full transcript"), a fragment the kit bans.
    for (const x of captionSentences(caption).filter(x => !/^[a-z]/.test(x))) {
        const last = s[s.length - 1];
        if (last && words(last).length <= 6 && /\b(this|that|it|here's how)\.$/i.test(last)) s[s.length - 1] = `${last} ${x}`;
        else s.push(x);
    }
    if (s.length < 3) return null;
    const turn = [...s].reverse().find(isTurn);
    const body = s.filter(x => x !== turn);
    if (body.length < 2) return null;
    // The caption's opening line is the approved hook and stays when it passes (6 of 10). Otherwise the best-scoring
    // sentence opens; ties go to the earlier one.
    const hook = hookScore(body[0]!) >= HOOK_PASS ? body[0]! : body.reduce((best, x) => hookScore(x) > hookScore(best) ? x : best, body[0]!);
    const points = body.filter(x => x !== hook);
    const { keyword, reward } = ctaParts(caption);
    const cta = keyword ? `Comment ${keyword} on the reel\nand I'll send you ${reward ?? 'it'}` : 'The full reel is on my profile';
    return { hook, points, ...(turn ? { turn } : {}), cta, ...(keyword ? { keyword } : {}), ...(reward ? { reward } : {}) };
}
