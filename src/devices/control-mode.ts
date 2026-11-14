export type PhoneControlMode = 'wda' | 'mirroring';

export function phoneControlMode(value = process.env.PHONE_FARM_CONTROL_MODE): PhoneControlMode {
    if (!value || value === 'wda') return 'wda';
    if (value === 'mirroring') return 'mirroring';
    throw new Error('PHONE_FARM_CONTROL_MODE must be wda or mirroring');
}

export function requireWdaControl(): void {
    if (phoneControlMode() !== 'wda')
        throw new Error('iPhone Mirroring is selected. This WDA action is disabled; no XCTest fallback will run.');
}
