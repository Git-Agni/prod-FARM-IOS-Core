export interface Point {
    x: number;
    y: number;
}

export interface DeviceCoordinates {
    displayName: string;
    productTypes: readonly string[];
    screenSize: {
        width: number;
        height: number;
    };
    passcodeKeypad: {
        columnX: [number, number, number];
        rowY: [number, number, number, number];
    };
    tiktok: {
        profileTab: Point;
        homeTab: Point;
        accountSwitcher: Point;
        create: Point;
        upload: Point;
        selectMultiple: Point;
        useLayout: Point;
        picker: {
            circleX: number;
            columnStep: number;
            firstY: number;
            trayY: number;
            rowStep: number;
            cellX: number;
            cellStep: number;
            cellY: number;
        };
        pickerNext: Point;
        editorNext: Point;
        caption: Point;
        keyboardBack: Point;
        draft: Point;
        finish: Point;
        like: Point;
        save: Point;
        swipe: {
            x: number;
            startY: number;
            endY: number;
            durationMs: number;
        };
    };
}

export const DEFAULT_COORDINATE_PROFILE = 'iphone8';

// Add another named layout here, then set that key as coordinateProfile on
// the matching devices.json entry. Devices without a key use iphone8.
export const DEVICE_COORDINATES = {
    iphone8: {
        displayName: 'iPhone 8',
        productTypes: ['iPhone10,1', 'iPhone10,4'],
        screenSize: { width: 375, height: 667 },
        passcodeKeypad: {
            columnX: [103, 191, 275],
            rowY: [220, 347, 425, 506],
        },
        tiktok: {
            profileTab: { x: 338, y: 656 },
            homeTab: { x: 38, y: 653 },
            accountSwitcher: { x: 185, y: 158 },
            create: { x: 187, y: 640 },
            upload: { x: 30, y: 635 },
            selectMultiple: { x: 24, y: 618 },
            useLayout: { x: 24, y: 489 },
            picker: {
                circleX: 106,
                columnStep: 126,
                firstY: 482,
                trayY: 360,
                rowStep: 125,
                cellX: 62,
                cellStep: 125,
                cellY: 526,
            },
            pickerNext: { x: 277, y: 617 },
            editorNext: { x: 277, y: 637 },
            caption: { x: 120, y: 236 },
            keyboardBack: { x: 22, y: 42 },
            draft: { x: 98, y: 630 },
            finish: { x: 277, y: 630 },
            like: { x: 345, y: 313 },
            save: { x: 345, y: 444 },
            swipe: { x: 187, startY: 550, endY: 150, durationMs: 450 },
        },
    },
} satisfies Record<string, DeviceCoordinates>;

export type CoordinateProfile = keyof typeof DEVICE_COORDINATES;
export type DeviceProfileName = CoordinateProfile;
export const DEFAULT_DEVICE_PROFILE = DEFAULT_COORDINATE_PROFILE;

export interface CoordinateProfileSummary {
    name: CoordinateProfile;
    displayName: string;
    productTypes: readonly string[];
    screenSize: DeviceCoordinates['screenSize'];
}

export function coordinateProfiles(): CoordinateProfileSummary[] {
    return Object.entries(DEVICE_COORDINATES).map(([name, coordinates]) => ({
        name: name as CoordinateProfile,
        displayName: coordinates.displayName,
        productTypes: [...coordinates.productTypes],
        screenSize: { ...coordinates.screenSize },
    }));
}

export function profileForProductType(productType: string | undefined): CoordinateProfile | undefined {
    if (!productType) return;
    return coordinateProfiles().find(({ productTypes }) => productTypes.includes(productType))?.name;
}

export function modelNameForProductType(productType: string | undefined): string | undefined {
    if (!productType) return;
    return coordinateProfiles().find(({ productTypes }) => productTypes.includes(productType))?.displayName;
}

export function coordinatesForProfile(profile: string = DEFAULT_COORDINATE_PROFILE): DeviceCoordinates {
    if (!(profile in DEVICE_COORDINATES)) {
        throw new Error(`Unknown coordinate profile "${profile}". Add it to src/devices/coordinates.ts.`);
    }
    return DEVICE_COORDINATES[profile as CoordinateProfile];
}

// The single-tap TikTok targets an operator can re-point from the dashboard.
// (picker grid, swipe vector and the passcode keypad are not single points and
// stay profile-level for now.)
export const CALIBRATABLE_POINTS = [
    'profileTab', 'homeTab', 'accountSwitcher', 'create', 'upload', 'selectMultiple', 'useLayout',
    'pickerNext', 'editorNext', 'caption', 'keyboardBack', 'draft', 'finish', 'like', 'save',
] as const;

export type CalibratablePoint = typeof CALIBRATABLE_POINTS[number];

export const POINT_LABELS: Record<CalibratablePoint, string> = {
    profileTab: 'Profile tab', homeTab: 'Home tab', accountSwitcher: 'Account switcher',
    create: 'Create (+)', upload: 'Upload', selectMultiple: 'Select multiple', useLayout: 'Use layout',
    pickerNext: 'Media picker · Next', editorNext: 'Editor · Next', caption: 'Caption field',
    keyboardBack: 'Keyboard · back', draft: 'Save draft', finish: 'Post / Finish',
    like: 'Like button', save: 'Save/bookmark button',
};

/** Per-device overrides for the calibratable points, stored on the devices.json entry. */
export type DeviceCoordinateOverrides = Partial<Record<CalibratablePoint, Point>>;

/** The profile's coordinates with any per-device single-tap overrides applied. */
export function resolveDeviceCoordinates(
    profile: string | undefined,
    overrides: DeviceCoordinateOverrides | undefined,
): DeviceCoordinates {
    const base = coordinatesForProfile(profile);
    if (!overrides) return base;
    const tiktok = { ...base.tiktok };
    for (const name of CALIBRATABLE_POINTS) {
        const point = overrides[name];
        if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
            tiktok[name] = { x: Math.round(point.x), y: Math.round(point.y) };
        }
    }
    return { ...base, tiktok };
}

/** Validate an override map: known keys only, integer points within the profile's screen. */
export function validateCoordinateOverrides(
    value: unknown,
    profile: string | undefined,
): DeviceCoordinateOverrides {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('coordinates must be an object');
    const { width, height } = coordinatesForProfile(profile).screenSize;
    const result: DeviceCoordinateOverrides = {};
    for (const [key, point] of Object.entries(value as Record<string, unknown>)) {
        if (!CALIBRATABLE_POINTS.includes(key as CalibratablePoint)) throw new Error(`Unknown calibratable point "${key}"`);
        if (!point || typeof point !== 'object') throw new Error(`${key} must be a {x, y} point`);
        const { x, y } = point as { x: unknown; y: unknown };
        if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`${key} x and y must be numbers`);
        }
        if (x < 0 || y < 0 || x > width || y > height) {
            throw new Error(`${key} (${x}, ${y}) is outside the ${width}×${height} screen`);
        }
        result[key as CalibratablePoint] = { x: Math.round(x), y: Math.round(y) };
    }
    return result;
}
