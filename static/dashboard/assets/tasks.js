const schedulesElement = document.querySelector('#schedules');
const executionsElement = document.querySelector('#executions');
const refresh = document.querySelector('#refresh-tasks');
function shortDevice(udid) {
    return udid.length > 20 ? `${udid.slice(0, 8)}…${udid.slice(-6)}` : udid;
}
function date(value) {
    return value ? new Date(value).toLocaleString() : '—';
}
async function request(url, options) {
    const response = await fetch(url, options);
    const body = await response.json();
    if (!response.ok)
        throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
}
function button(label, action) {
    const value = document.createElement('button');
    value.className = 'icon-button';
    value.type = 'button';
    value.textContent = label;
    value.addEventListener('click', () => void action().catch((error) => {
        window.alert(error instanceof Error ? error.message : String(error));
    }));
    return value;
}
function renderSchedules(items) {
    if (!items.length) {
        schedulesElement.className = 'task-list empty-state';
        schedulesElement.textContent = 'No schedules yet.';
        return;
    }
    schedulesElement.className = 'task-list';
    schedulesElement.replaceChildren(...items.map((schedule) => {
        const row = document.createElement('article');
        row.className = 'task-row';
        const copy = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = `${schedule.taskType} · ${shortDevice(schedule.deviceUdid)}`;
        const meta = document.createElement('p');
        meta.textContent = `${schedule.timing.kind} · next ${date(schedule.nextRunAt)}`;
        copy.append(title, meta);
        const state = document.createElement('span');
        state.className = `status ${schedule.status}`;
        state.textContent = schedule.status;
        const actions = document.createElement('div');
        actions.className = 'inline-actions';
        if (schedule.status === 'active' || schedule.status === 'paused')
            actions.append(button('Edit', async () => {
                const timingText = window.prompt('Edit timing JSON', JSON.stringify(schedule.timing));
                if (!timingText)
                    return;
                const windowText = window.prompt('Run-within window in minutes', String(schedule.runWindowMinutes));
                if (!windowText)
                    return;
                const timing = JSON.parse(timingText);
                const recurringPublish = schedule.payload.type === 'post' && schedule.payload.destination === 'publish'
                    && (timing.kind === 'daily' || timing.kind === 'weekly');
                if (recurringPublish && !window.confirm('Confirm that this recurring schedule may publish publicly without confirmation on each occurrence.'))
                    return;
                await request(`/api/schedules/${schedule.id}`, {
                    method: 'PATCH', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ timing, runWindowMinutes: Number(windowText), recurringPublishConfirmed: recurringPublish }),
                });
                await load();
            }));
        if (schedule.status === 'active')
            actions.append(button('Pause', async () => { await request(`/api/schedules/${schedule.id}/pause`, { method: 'POST' }); await load(); }));
        if (schedule.status === 'paused')
            actions.append(button('Resume', async () => { await request(`/api/schedules/${schedule.id}/resume`, { method: 'POST' }); await load(); }));
        if (schedule.status !== 'cancelled' && schedule.status !== 'completed')
            actions.append(button('Cancel', async () => { await request(`/api/schedules/${schedule.id}/cancel`, { method: 'POST' }); await load(); }));
        row.append(copy, state, actions);
        return row;
    }));
}
function renderExecutions(items) {
    if (!items.length) {
        executionsElement.className = 'task-list empty-state';
        executionsElement.textContent = 'No executions yet.';
        return;
    }
    executionsElement.className = 'task-list';
    executionsElement.replaceChildren(...items.map((execution) => {
        const row = document.createElement('article');
        row.className = 'task-row';
        const copy = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = `${execution.taskType} · ${shortDevice(execution.deviceUdid)}`;
        const meta = document.createElement('p');
        meta.textContent = `${date(execution.scheduledFor)}${execution.error ? ` · ${execution.error}` : ''}`;
        copy.append(title, meta);
        const state = document.createElement('span');
        state.className = `status ${execution.status}`;
        state.textContent = execution.status;
        const actions = document.createElement('div');
        actions.className = 'inline-actions';
        if (execution.status === 'queued' || (execution.status === 'running' && execution.taskType === 'doomscroll')) {
            actions.append(button(execution.status === 'queued' ? 'Cancel' : 'Stop', async () => {
                await request(`/api/executions/${execution.id}/stop`, { method: 'POST' });
                await load();
            }));
        }
        if (execution.status === 'failed' || execution.status === 'stopped') {
            actions.append(button('Retry', async () => {
                if (execution.taskType === 'post' && !window.confirm('The post may already have reached TikTok. Retry only after checking the device.'))
                    return;
                await request(`/api/executions/${execution.id}/retry`, { method: 'POST' });
                await load();
            }));
        }
        row.append(copy, state, actions);
        return row;
    }));
}
async function load() {
    refresh.disabled = true;
    try {
        const [scheduleData, executionData] = await Promise.all([
            request('/api/schedules'),
            request('/api/executions'),
        ]);
        renderSchedules(scheduleData.schedules);
        renderExecutions(executionData.executions);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        schedulesElement.textContent = message;
        executionsElement.textContent = message;
    }
    finally {
        refresh.disabled = false;
    }
}
refresh.addEventListener('click', () => void load());
void load();
setInterval(() => void load(), 5_000);
export {};
