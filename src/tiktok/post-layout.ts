export interface PickerLayout {
    circleX: number;
    columnStep: number;
    firstY: number;
    trayY: number;
    rowStep: number;
}

export interface PickerTarget {
    x: number;
    y: number;
}

export function recentPickerTargets(assetCount: number, count: number, layout: PickerLayout): PickerTarget[] {
    if (!Number.isSafeInteger(assetCount) || assetCount < count || count < 1) {
        throw new Error('Photos asset count cannot satisfy the requested media selection');
    }
    const latestIndex = assetCount - 1;
    const latestRow = Math.floor(latestIndex / 3);
    return Array.from({ length: count }, (_, selection) => {
        const assetIndex = latestIndex - selection;
        const rowDifference = latestRow - Math.floor(assetIndex / 3);
        return {
            x: layout.circleX + ((assetIndex % 3) * layout.columnStep),
            y: selection === 0 ? layout.firstY : layout.trayY - (rowDifference * layout.rowStep),
        };
    });
}
