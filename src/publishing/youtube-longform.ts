import catalog from './youtube-longform.json' with {type: 'json'};
import type {PostingInput} from './model.js';

/** Antonio, Oct 19: every Short linked the same long-form video. Link the owned long-form video that matches the
 * Short's topic instead, chosen from youtube-longform.json. Deterministic: no model call at posting time. */
export interface LongFormVideo { id: string; seconds: number; titles: string[]; topics: string[] }
export const longFormCatalog = catalog as {channelId: string; owner: string; defaultId: string; videos: LongFormVideo[]};
export const longFormById = (id: string | undefined) => longFormCatalog.videos.find(v => v.id === id);
export const defaultLongForm = () => longFormById(longFormCatalog.defaultId)!;

const words = (value: string) => ' ' + value.toLowerCase().replace(/#/g, ' ').replace(/[^a-z0-9$/+-]+/g, ' ').trim() + ' ';
/** A topic counts once per field: 2 in the Short title, 1 in the description or tags. Below 2 keeps the default. */
export function chooseLongForm(input: Pick<PostingInput, 'caption'> & {youtube?: {title?: string; publishing?: {tags?: string[]}}}) {
    const title = words(input.youtube?.title ?? ''), rest = words(input.caption + ' ' + (input.youtube?.publishing?.tags ?? []).join(' '));
    let best = {video: defaultLongForm(), score: 0, topics: [] as string[]};
    for (const video of longFormCatalog.videos) {
        let score = 0; const topics: string[] = [];
        for (const topic of video.topics) {
            const t = words(topic), hit = (title.includes(t) ? 2 : 0) + (rest.includes(t) ? 1 : 0);
            if (hit) { score += hit; topics.push(topic); }
        }
        if (score > best.score) best = {video, score, topics};
    }
    return best.score >= 2 ? best : {video: defaultLongForm(), score: best.score, topics: [] as string[]};
}

/** The owned-video picker labels a row "Title - 15 minutes, 57 seconds - Go to channel - Owner". Match any known title. */
export const pickerRowMatches = (label: string | undefined, video: LongFormVideo) =>
    !!label && label.includes(' - Go to channel - ' + longFormCatalog.owner) && video.titles.some(t => label.startsWith(t + ' - '));
