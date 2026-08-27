export {};

interface ScreenSize {
    width: number;
    height: number;
}

interface DeviceConnectionStatus {
    physical: 'connected' | 'disconnected';
    wda: 'disconnected' | 'connecting' | 'unlock-required' | 'ready' | 'error';
    appium: 'ready' | 'unavailable';
    message: string;
}

type RemoteAction =
    | { type: 'tap'; x: number; y: number }
    | { type: 'home' }
    | { type: 'lock' }
    | { type: 'wake' }
    | { type: 'unlock' }
    | { type: 'volumeUp' }
    | { type: 'volumeDown' }
    | { type: 'swipe'; startX: number; startY: number; endX: number; endY: number; durationMs: number };

type SwipeDirection = 'left' | 'right' | 'up' | 'down';

interface Point {
    x: number;
    y: number;
    time?: number;
}

interface PostRun {
    status: 'idle' | 'running' | 'succeeded' | 'failed';
    destination: 'draft' | 'publish' | null;
    logs: string[];
}

interface DeviceSchedule {
    id: string;
    status: 'active' | 'paused' | 'completed' | 'cancelled';
    taskType: 'doomscroll' | 'post';
    timing: { kind: string; localTime?: string; timezone?: string; weekdays?: number[]; runAt?: string };
    nextRunAt: string | null;
    payload: {
        type: 'doomscroll' | 'post';
        destination?: 'draft' | 'publish';
        account?: string;
        durationMinutes?: number;
        personality?: string;
    };
}

interface DeviceExecution {
    id: string;
    taskType: 'doomscroll' | 'post';
    status: string;
    scheduledFor: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
}

function element<T extends Element>(selector: string): T {
    const value = document.querySelector<T>(selector);
    if (!value) throw new Error(`Missing element: ${selector}`);
    return value;
}

const udid = decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1) ?? '');
const elements = {
    screen: element<HTMLImageElement>('#screen'),
    status: element<HTMLElement>('#status'),
    statusText: element<HTMLElement>('#status span:last-child'),
    refresh: element<HTMLButtonElement>('#refresh'),
    toggle: element<HTMLButtonElement>('#toggle'),
    remoteButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-remote-action]')),
    openPost: element<HTMLButtonElement>('#open-post'),
    openDoomscroll: element<HTMLButtonElement>('#open-doomscroll'),
    doomscrollDialog: element<HTMLDialogElement>('#doomscroll-dialog'),
    closeDoomscroll: element<HTMLButtonElement>('#close-doomscroll'),
    cancelDoomscroll: element<HTMLButtonElement>('#cancel-doomscroll'),
    doomscrollDuration: element<HTMLInputElement>('#doomscroll-duration'),
    doomscrollDurationButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-doomscroll-duration]')),
    postDialog: element<HTMLDialogElement>('#post-dialog'),
    postForm: element<HTMLFormElement>('#post-form'),
    closePost: element<HTMLButtonElement>('#close-post'),
    cancelPost: element<HTMLButtonElement>('#cancel-post'),
    submitPost: element<HTMLButtonElement>('#submit-post'),
    media: element<HTMLInputElement>('#media'),
    mediaList: element<HTMLOListElement>('#media-list'),
    musicUrl: element<HTMLInputElement>('#music-url'),
    caption: element<HTMLTextAreaElement>('#caption'),
    postAccount: element<HTMLSelectElement>('#post-account'),
    publishConfirm: element<HTMLElement>('#publish-confirm'),
    confirmPublish: element<HTMLInputElement>('#confirm-publish'),
    postResult: element<HTMLElement>('#post-result'),
    doomscrollForm: element<HTMLFormElement>('#doomscroll-form'),
    doomscrollRecurring: element<HTMLInputElement>('#doomscroll-recurring'),
    doomscrollStartOptions: element<HTMLElement>('#doomscroll-start-options'),
    doomscrollStartKind: element<HTMLSelectElement>('#doomscroll-start-kind'),
    doomscrollOnceFields: element<HTMLElement>('#doomscroll-once-fields'),
    doomscrollRecurringFields: element<HTMLElement>('#doomscroll-recurring-fields'),
    doomscrollFrequency: element<HTMLSelectElement>('#doomscroll-frequency'),
    doomscrollWeekdayFields: element<HTMLElement>('#doomscroll-weekday-fields'),
    doomscrollWeekdayInputs: Array.from(document.querySelectorAll<HTMLInputElement>('#doomscroll-weekday-fields input[type="checkbox"]')),
    doomscrollRunWindowField: element<HTMLElement>('#doomscroll-run-window-field'),
    doomscrollScheduleKind: element<HTMLInputElement>('#doomscroll-schedule-kind'),
    doomscrollWeekdays: element<HTMLInputElement>('#doomscroll-weekdays'),
    doomscrollRunAt: element<HTMLInputElement>('#doomscroll-run-at'),
    doomscrollRunAtIso: element<HTMLInputElement>('#doomscroll-run-at-iso'),
    timezoneInputs: Array.from(document.querySelectorAll<HTMLInputElement>('.browser-timezone')),
    postRecurring: element<HTMLInputElement>('#post-recurring'),
    postStartOptions: element<HTMLElement>('#post-start-options'),
    postStartKind: element<HTMLSelectElement>('#post-start-kind'),
    postOnceFields: element<HTMLElement>('#post-once-fields'),
    postRecurringFields: element<HTMLElement>('#post-recurring-fields'),
    postFrequency: element<HTMLSelectElement>('#post-frequency'),
    postWeekdayFields: element<HTMLElement>('#post-weekday-fields'),
    postWeekdayInputs: Array.from(document.querySelectorAll<HTMLInputElement>('#post-weekday-fields input[type="checkbox"]')),
    postRunWindowField: element<HTMLElement>('#post-run-window-field'),
    postRunAt: element<HTMLInputElement>('#post-run-at'),
    postLocalTime: element<HTMLInputElement>('#post-local-time'),
    postRunWindow: element<HTMLInputElement>('#post-run-window'),
    accountsForm: element<HTMLFormElement>('#accounts-form'),
    deviceAccounts: element<HTMLInputElement>('#device-accounts'),
    accountsResult: element<HTMLElement>('#accounts-result'),
    deviceSchedules: element<HTMLElement>('#device-schedules'),
    deviceExecutions: element<HTMLElement>('#device-executions'),
    removeDevice: element<HTMLButtonElement>('#remove-device'),
    removeResult: element<HTMLElement>('#remove-result'),
};

let screenSize: ScreenSize | undefined;
let paused = false;
let connecting = false;
let pointerStart: Point | undefined;
let orderedMedia: File[] = [];
let postPoll: number | undefined;
let connectionPoll: number | undefined;
let connectionChecking = false;
const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
elements.timezoneInputs.forEach((input) => { input.value = browserTimezone; });

function selectedWeekdays(inputs: HTMLInputElement[]): number[] {
    return inputs.filter(({ checked }) => checked).map(({ value }) => Number(value));
}

function updateDoomscrollSchedule(): void {
    const recurring = elements.doomscrollRecurring.checked;
    const kind = recurring ? elements.doomscrollFrequency.value : elements.doomscrollStartKind.value;
    elements.doomscrollScheduleKind.value = kind;
    elements.doomscrollWeekdays.value = selectedWeekdays(elements.doomscrollWeekdayInputs).join(',');
    elements.doomscrollStartOptions.hidden = recurring;
    elements.doomscrollOnceFields.hidden = recurring || kind !== 'once';
    elements.doomscrollRecurringFields.hidden = !recurring;
    elements.doomscrollWeekdayFields.hidden = !recurring || kind !== 'weekly';
    elements.doomscrollRunWindowField.hidden = kind === 'now';
    elements.doomscrollRunAt.required = kind === 'once';
}

function updatePostSchedule(): void {
    const recurring = elements.postRecurring.checked;
    const kind = recurring ? elements.postFrequency.value : elements.postStartKind.value;
    elements.postStartOptions.hidden = recurring;
    elements.postOnceFields.hidden = recurring || kind !== 'once';
    elements.postRecurringFields.hidden = !recurring;
    elements.postWeekdayFields.hidden = !recurring || kind !== 'weekly';
    elements.postRunWindowField.hidden = kind === 'now';
    elements.postRunAt.required = kind === 'once';
}

elements.doomscrollRecurring.addEventListener('change', updateDoomscrollSchedule);
elements.doomscrollStartKind.addEventListener('change', updateDoomscrollSchedule);
elements.doomscrollFrequency.addEventListener('change', updateDoomscrollSchedule);
elements.doomscrollWeekdayInputs.forEach((input) => input.addEventListener('change', updateDoomscrollSchedule));
elements.postRecurring.addEventListener('change', updatePostSchedule);
elements.postStartKind.addEventListener('change', updatePostSchedule);
elements.postFrequency.addEventListener('change', updatePostSchedule);
elements.doomscrollForm.addEventListener('submit', () => {
    updateDoomscrollSchedule();
    elements.doomscrollRunAtIso.value = elements.doomscrollRunAt.value
        ? new Date(elements.doomscrollRunAt.value).toISOString()
        : '';
});
elements.openDoomscroll.addEventListener('click', () => elements.doomscrollDialog.showModal());
elements.closeDoomscroll.addEventListener('click', () => elements.doomscrollDialog.close());
elements.cancelDoomscroll.addEventListener('click', () => elements.doomscrollDialog.close());
elements.doomscrollDurationButtons.forEach((button) => {
    button.addEventListener('click', () => {
        elements.doomscrollDuration.value = button.dataset.doomscrollDuration ?? '';
    });
});

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function setStatus(message: string, state = ''): void {
    elements.status.className = `status ${state}`;
    elements.statusText.textContent = message;
}

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options);
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
    return data;
}

function startStream(): void {
    if (paused || !screenSize) return;
    setStatus('Connecting video stream…');
    elements.screen.src = `/api/devices/${encodeURIComponent(udid)}/remote/stream?t=${Date.now()}`;
}

async function connectRemote(): Promise<void> {
    if (paused || connecting || !screenSize) return;
    connecting = true;
    try {
        startStream();
    } finally {
        connecting = false;
    }
}

async function pollConnection(reloadWhenReady = false): Promise<void> {
    if (connectionChecking) return;
    connectionChecking = true;
    window.clearTimeout(connectionPoll);
    try {
        const connection = await jsonRequest<DeviceConnectionStatus>(
            `/api/devices/${encodeURIComponent(udid)}/connection`,
        );
        if (connection.wda === 'ready') {
            if (reloadWhenReady) {
                location.reload();
                return;
            }
            connectionPoll = window.setTimeout(() => void connectRemote(), 2_000);
            return;
        }
        const appium = connection.appium === 'ready' ? '' : ' Appium is unavailable.';
        setStatus(`${connection.message}.${appium}`.replace('..', '.'), connection.wda === 'error' ? 'error' : '');
        connectionPoll = window.setTimeout(() => void pollConnection(reloadWhenReady), 2_000);
    } catch (error) {
        setStatus(errorMessage(error), 'error');
        connectionPoll = window.setTimeout(() => void pollConnection(reloadWhenReady), 2_000);
    } finally {
        connectionChecking = false;
    }
}

function useDeviceSummary(summary: HTMLElement): void {
    const width = Number(summary.dataset.screenWidth);
    const height = Number(summary.dataset.screenHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    screenSize = { width, height };
    const name = summary.querySelector('h1')?.textContent;
    if (name) document.title = `${name} · iOS Automation`;
    void connectRemote();
}

document.addEventListener('htmx:afterSwap', () => {
    const summary = document.querySelector<HTMLElement>('#device-summary[data-screen-width]');
    if (summary) useDeviceSummary(summary);
});

document.addEventListener('htmx:afterRequest', (event) => {
    const detail = (event as CustomEvent<{ elt?: Element; successful?: boolean }>).detail;
    if (detail?.elt === elements.doomscrollForm && detail.successful) {
        elements.doomscrollDialog.close();
    }
});

function pointFromEvent(event: PointerEvent): Point {
    if (!screenSize) throw new Error('Screen dimensions are unavailable');
    const rect = elements.screen.getBoundingClientRect();
    return {
        x: Math.round((event.clientX - rect.left) * screenSize.width / rect.width),
        y: Math.round((event.clientY - rect.top) * screenSize.height / rect.height),
    };
}

async function sendAction(action: RemoteAction): Promise<void> {
    setStatus('Sending input…');
    elements.remoteButtons.forEach((button) => { button.disabled = true; });
    try {
        await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/remote/action`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(action),
        });
        setStatus(action.type === 'tap' ? `Tapped (${action.x}, ${action.y})` : 'Remote connected', 'ready');
    } catch (error) {
        setStatus(errorMessage(error), 'error');
    } finally {
        elements.remoteButtons.forEach((button) => { button.disabled = false; });
    }
}

function directionalSwipe(direction: SwipeDirection): RemoteAction | undefined {
    if (!screenSize) {
        setStatus('Screen dimensions are unavailable', 'error');
        return;
    }
    const left = Math.round(screenSize.width * 0.22);
    const right = Math.round(screenSize.width * 0.78);
    const top = Math.round(screenSize.height * 0.25);
    const bottom = Math.round(screenSize.height * 0.75);
    const centerX = Math.round(screenSize.width / 2);
    const centerY = Math.round(screenSize.height / 2);
    const points: Record<SwipeDirection, [number, number, number, number]> = {
        left: [right, centerY, left, centerY],
        right: [left, centerY, right, centerY],
        up: [centerX, bottom, centerX, top],
        down: [centerX, top, centerX, bottom],
    };
    const [startX, startY, endX, endY] = points[direction];
    return { type: 'swipe', startX, startY, endX, endY, durationMs: 350 };
}

elements.remoteButtons.forEach((button) => {
    button.addEventListener('click', () => {
        const action = button.dataset.remoteAction;
        if (action === 'home' || action === 'lock' || action === 'wake'
            || action === 'unlock' || action === 'volumeUp' || action === 'volumeDown') {
            void sendAction({ type: action });
            return;
        }
        if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
            const swipe = directionalSwipe(action);
            if (swipe) void sendAction(swipe);
        }
    });
});

elements.screen.addEventListener('pointerdown', (event) => {
    if (!screenSize) return;
    elements.screen.setPointerCapture(event.pointerId);
    pointerStart = { ...pointFromEvent(event), time: performance.now() };
});
elements.screen.addEventListener('pointerup', (event) => {
    if (!pointerStart || !screenSize) return;
    const end = pointFromEvent(event);
    const start = pointerStart;
    pointerStart = undefined;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    if (distance < 12) {
        void sendAction({ type: 'tap', x: end.x, y: end.y });
    } else {
        const durationMs = Math.max(150, Math.min(1200, Math.round(performance.now() - (start.time ?? 0))));
        void sendAction({
            type: 'swipe',
            startX: start.x,
            startY: start.y,
            endX: end.x,
            endY: end.y,
            durationMs,
        });
    }
});
elements.screen.addEventListener('pointercancel', () => { pointerStart = undefined; });
elements.screen.addEventListener('load', () => setStatus('Live video connected', 'ready'));
elements.screen.addEventListener('error', () => {
    if (paused) return;
    elements.screen.removeAttribute('src');
    setStatus('Video stream disconnected; checking the phone connection…', 'error');
    void pollConnection();
});
elements.refresh.addEventListener('click', async () => {
    elements.refresh.disabled = true;
    window.clearTimeout(connectionPoll);
    elements.screen.removeAttribute('src');
    setStatus('Restarting the phone connection…');
    try {
        await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/reconnect`, { method: 'POST' });
        elements.refresh.disabled = false;
        void pollConnection(true);
    } catch (error) {
        setStatus(errorMessage(error), 'error');
        elements.refresh.disabled = false;
    }
});
elements.toggle.addEventListener('click', () => {
    paused = !paused;
    elements.toggle.textContent = paused ? 'Resume stream' : 'Pause stream';
    if (paused) {
        elements.screen.removeAttribute('src');
        setStatus('Video stream paused');
    } else {
        void connectRemote();
    }
});

function renderMedia(): void {
    elements.mediaList.replaceChildren(...orderedMedia.map((file, index) => {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = `${index + 1}. ${file.name}`;
        const up = document.createElement('button');
        up.type = 'button'; up.textContent = '↑'; up.title = 'Move earlier'; up.disabled = index === 0;
        const down = document.createElement('button');
        down.type = 'button'; down.textContent = '↓'; down.title = 'Move later'; down.disabled = index === orderedMedia.length - 1;
        const remove = document.createElement('button');
        remove.type = 'button'; remove.textContent = 'Remove';
        up.addEventListener('click', () => { [orderedMedia[index - 1], orderedMedia[index]] = [orderedMedia[index]!, orderedMedia[index - 1]!]; renderMedia(); });
        down.addEventListener('click', () => { [orderedMedia[index], orderedMedia[index + 1]] = [orderedMedia[index + 1]!, orderedMedia[index]!]; renderMedia(); });
        remove.addEventListener('click', () => { orderedMedia.splice(index, 1); renderMedia(); });
        item.append(name, up, down, remove);
        return item;
    }));
}

function selectedDestination(): 'draft' | 'publish' {
    return (elements.postForm.elements.namedItem('destination') as RadioNodeList).value as 'draft' | 'publish';
}

function postTiming(): Record<string, unknown> {
    const kind = elements.postRecurring.checked ? elements.postFrequency.value : elements.postStartKind.value;
    if (kind === 'now') return { kind };
    if (kind === 'once') {
        if (!elements.postRunAt.value) throw new Error('Choose a one-time start date');
        return { kind, runAt: new Date(elements.postRunAt.value).toISOString() };
    }
    if (kind === 'daily') return { kind, localTime: elements.postLocalTime.value, timezone: browserTimezone };
    const weekdays = selectedWeekdays(elements.postWeekdayInputs);
    if (weekdays.length === 0) throw new Error('Choose at least one recurring day');
    return {
        kind: 'weekly', localTime: elements.postLocalTime.value, timezone: browserTimezone,
        weekdays,
    };
}

function updateDestination(): void {
    const publishing = selectedDestination() === 'publish';
    elements.publishConfirm.classList.toggle('visible', publishing);
    if (!publishing) elements.confirmPublish.checked = false;
    elements.submitPost.textContent = publishing ? 'Post publicly' : 'Save to Drafts';
}

async function pollPost(): Promise<void> {
    try {
        const run = await jsonRequest<PostRun>(`/api/devices/${encodeURIComponent(udid)}/posts/current`);
        elements.postResult.textContent = run.status === 'running'
            ? 'Post automation is running. Follow its live output in the Automation log.'
            : '';
        if (run.status === 'running') {
            postPoll = window.setTimeout(() => void pollPost(), 1000);
        } else {
            elements.submitPost.disabled = false;
            elements.postResult.textContent = run.status === 'succeeded'
                ? `Completed: ${run.destination === 'publish' ? 'post submitted' : 'draft saved'}.`
                : 'Automation failed. Review the Automation log and the phone screen.';
        }
    } catch (error) {
        elements.postResult.textContent = errorMessage(error);
        elements.submitPost.disabled = false;
    }
}

function formatDate(value: string | null): string {
    return value ? new Date(value).toLocaleString() : '—';
}

function taskActionButton(label: string, action: () => Promise<void>): HTMLButtonElement {
    const buttonElement = document.createElement('button');
    buttonElement.className = 'icon-button';
    buttonElement.type = 'button';
    buttonElement.textContent = label;
    buttonElement.addEventListener('click', () => {
        void (async () => {
            try {
                await action();
                await loadDeviceTasks();
            } catch (error) {
                window.alert(errorMessage(error));
            }
        })();
    });
    return buttonElement;
}

function taskTitle(taskType: DeviceSchedule['taskType'], payload?: DeviceSchedule['payload']): string {
    if (taskType === 'doomscroll') {
        const details = payload?.durationMinutes ? ` · ${payload.durationMinutes} min` : '';
        return `Doomscroll${details}`;
    }
    const destination = payload?.destination === 'publish' ? 'Post publicly' : 'Save to drafts';
    return payload?.account ? `${destination} · ${payload.account}` : destination;
}

function timingDescription(timing: DeviceSchedule['timing']): string {
    if (timing.kind === 'once') return `Once · ${formatDate(timing.runAt ?? null)}`;
    if (timing.kind === 'daily') return `Daily · ${timing.localTime ?? '—'} · ${timing.timezone ?? 'local time'}`;
    if (timing.kind === 'weekly') {
        const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const days = timing.weekdays?.map((day) => names[day] ?? String(day)).join(', ') || 'no days';
        return `Weekly ${days} · ${timing.localTime ?? '—'} · ${timing.timezone ?? 'local time'}`;
    }
    return 'Run immediately';
}

function renderDeviceSchedules(schedules: DeviceSchedule[]): void {
    if (!schedules.length) {
        elements.deviceSchedules.className = 'task-list empty-state';
        elements.deviceSchedules.textContent = 'No schedules for this device.';
        return;
    }
    elements.deviceSchedules.className = 'task-list';
    elements.deviceSchedules.replaceChildren(...schedules.map((schedule) => {
        const row = document.createElement('article');
        row.className = 'task-row';
        const copy = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = taskTitle(schedule.taskType, schedule.payload);
        const meta = document.createElement('p');
        meta.textContent = `${timingDescription(schedule.timing)} · next ${formatDate(schedule.nextRunAt)}`;
        copy.append(title, meta);
        const state = document.createElement('span');
        state.className = `status ${schedule.status}`;
        state.textContent = schedule.status;
        const actions = document.createElement('div');
        actions.className = 'inline-actions';
        if (schedule.status === 'active') actions.append(taskActionButton('Pause', async () => {
            await jsonRequest(`/api/schedules/${schedule.id}/pause`, { method: 'POST' });
        }));
        if (schedule.status === 'paused') actions.append(taskActionButton('Resume', async () => {
            await jsonRequest(`/api/schedules/${schedule.id}/resume`, { method: 'POST' });
        }));
        if (schedule.status !== 'cancelled' && schedule.status !== 'completed') {
            actions.append(taskActionButton('Cancel', async () => {
                await jsonRequest(`/api/schedules/${schedule.id}/cancel`, { method: 'POST' });
            }));
        }
        row.append(copy, state, actions);
        return row;
    }));
}

function renderDeviceExecutions(executions: DeviceExecution[]): void {
    if (!executions.length) {
        elements.deviceExecutions.className = 'task-list empty-state';
        elements.deviceExecutions.textContent = 'No task runs for this device yet.';
        return;
    }
    elements.deviceExecutions.className = 'task-list';
    elements.deviceExecutions.replaceChildren(...executions.map((execution) => {
        const row = document.createElement('article');
        row.className = 'task-row';
        const copy = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = execution.taskType === 'post' ? 'Post' : 'Doomscroll';
        const meta = document.createElement('p');
        meta.textContent = `${formatDate(execution.scheduledFor)}${execution.error ? ` · ${execution.error}` : ''}`;
        copy.append(title, meta);
        const state = document.createElement('span');
        state.className = `status ${execution.status}`;
        state.textContent = execution.status;
        const actions = document.createElement('div');
        actions.className = 'inline-actions';
        if (execution.status === 'queued' || (execution.status === 'running' && execution.taskType === 'doomscroll')) {
            actions.append(taskActionButton(execution.status === 'queued' ? 'Cancel' : 'Stop', async () => {
                await jsonRequest(`/api/executions/${execution.id}/stop`, { method: 'POST' });
            }));
        }
        if (execution.status === 'failed' || execution.status === 'stopped') {
            actions.append(taskActionButton('Retry', async () => {
                if (execution.taskType === 'post'
                    && !window.confirm('The post may already have reached TikTok. Retry only after checking the device.')) return;
                await jsonRequest(`/api/executions/${execution.id}/retry`, { method: 'POST' });
            }));
        }
        row.append(copy, state, actions);
        return row;
    }));
}

async function loadDeviceTasks(): Promise<void> {
    try {
        const query = `deviceUdid=${encodeURIComponent(udid)}`;
        const [scheduleData, executionData] = await Promise.all([
            jsonRequest<{ schedules: DeviceSchedule[] }>(`/api/schedules?${query}`),
            jsonRequest<{ executions: DeviceExecution[] }>(`/api/executions?${query}`),
        ]);
        renderDeviceSchedules(scheduleData.schedules);
        renderDeviceExecutions(executionData.executions);
    } catch (error) {
        const message = errorMessage(error);
        elements.deviceSchedules.className = 'task-list empty-state';
        elements.deviceSchedules.textContent = message;
        elements.deviceExecutions.className = 'task-list empty-state';
        elements.deviceExecutions.textContent = message;
    }
}

elements.openPost.addEventListener('click', () => elements.postDialog.showModal());
elements.closePost.addEventListener('click', () => elements.postDialog.close());
elements.cancelPost.addEventListener('click', () => elements.postDialog.close());
elements.media.addEventListener('change', () => {
    orderedMedia = Array.from(elements.media.files ?? []);
    renderMedia();
});
elements.postForm.addEventListener('change', (event) => {
    if ((event.target as HTMLInputElement).name === 'destination') updateDestination();
});
elements.postForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const destination = selectedDestination();
    if (orderedMedia.length === 0) { elements.postResult.textContent = 'Choose media first.'; return; }
    if (orderedMedia.length > 3) { elements.postResult.textContent = 'Choose no more than three slideshow images.'; return; }
    const videos = orderedMedia.filter(({ type }) => type.startsWith('video/'));
    const images = orderedMedia.filter(({ type }) => type.startsWith('image/'));
    if (!((videos.length === 1 && orderedMedia.length === 1) || images.length === orderedMedia.length)) {
        elements.postResult.textContent = 'Choose exactly one video, or only slideshow images.'; return;
    }
    if (destination === 'publish' && !elements.confirmPublish.checked) {
        elements.postResult.textContent = 'Confirm public publishing before continuing.'; return;
    }
    const form = new FormData();
    for (const file of orderedMedia) form.append('media', file, file.name);
    form.append('destination', destination);
    form.append('musicUrl', elements.musicUrl.value);
    form.append('caption', elements.caption.value);
    form.append('account', elements.postAccount.value);
    try {
        form.append('timing', JSON.stringify(postTiming()));
    } catch (error) {
        elements.postResult.textContent = errorMessage(error); return;
    }
    form.append('runWindowMinutes', elements.postRunWindow.value);
    form.append('recurringPublishConfirmed', String(destination !== 'publish' || elements.confirmPublish.checked));
    elements.submitPost.disabled = true;
    elements.postResult.textContent = 'Uploading media to the automation server…';
    try {
        const result = await jsonRequest<{ status: string }>(`/api/devices/${encodeURIComponent(udid)}/posts`, { method: 'POST', body: form });
        window.clearTimeout(postPoll);
        if (result.status === 'running') {
            await pollPost();
        } else {
            elements.submitPost.disabled = false;
            elements.postResult.textContent = 'Post automation scheduled. Follow its status and live output in the Automation log.';
        }
        void loadDeviceTasks();
    } catch (error) {
        elements.postResult.textContent = errorMessage(error);
        elements.submitPost.disabled = false;
    }
});

elements.accountsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.accountsResult.textContent = 'Saving…';
    try {
        const result = await jsonRequest<{ accounts: string[] }>(`/api/devices/${encodeURIComponent(udid)}/accounts`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accounts: elements.deviceAccounts.value.split(',') }),
        });
        const previousDoomscroll = (document.querySelector<HTMLSelectElement>('#doomscroll-account'))?.value ?? '';
        elements.postAccount.replaceChildren(new Option('Choose an account…', '', false, true));
        elements.postAccount.options[0]!.disabled = true;
        const doomscrollAccount = element<HTMLSelectElement>('#doomscroll-account');
        doomscrollAccount.replaceChildren(new Option("Don't switch", ''));
        for (const account of result.accounts) {
            elements.postAccount.add(new Option(account, account));
            doomscrollAccount.add(new Option(account, account));
        }
        if (result.accounts.includes(previousDoomscroll)) doomscrollAccount.value = previousDoomscroll;
        elements.deviceAccounts.value = result.accounts.join(', ');
        elements.accountsResult.textContent = result.accounts.length ? 'Accounts saved.' : 'Account switching is optional.';
    } catch (error) {
        elements.accountsResult.textContent = errorMessage(error);
    }
});

elements.removeDevice.addEventListener('click', async () => {
    if (!confirm("Remove this device? Its schedules will be cancelled and its configuration forgotten.")) return;
    elements.removeDevice.disabled = true;
    elements.removeResult.textContent = 'Removing…';
    try {
        const response = await fetch(`/api/devices/${encodeURIComponent(udid)}`, { method: 'DELETE' });
        if (!response.ok) {
            const data = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(data.error ?? `Request failed (${response.status})`);
        }
        location.href = '/';
    } catch (error) {
        elements.removeDevice.disabled = false;
        elements.removeResult.textContent = errorMessage(error);
    }
});

updateDestination();
updateDoomscrollSchedule();
updatePostSchedule();
void loadDeviceTasks();
setInterval(() => void loadDeviceTasks(), 5_000);

const loadedSummary = document.querySelector<HTMLElement>('#device-summary[data-screen-width]');
if (loadedSummary) useDeviceSummary(loadedSummary);
