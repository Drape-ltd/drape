"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateShoulderYawDegrees = estimateShoulderYawDegrees;
exports.angleIndexForDegrees = angleIndexForDegrees;
exports.targetAngleForIndex = targetAngleForIndex;
const constants_1 = require("./constants");
const geometry_1 = require("./geometry");
function estimateShoulderYawDegrees(input) {
    if (input.frontShoulderWidthPx <= 0) {
        throw new Error('frontShoulderWidthPx must be positive.');
    }
    const observedWidth = (0, geometry_1.distance2D)(input.leftShoulder, input.rightShoulder);
    const widthRatio = (0, geometry_1.clamp)(observedWidth / input.frontShoulderWidthPx, 0, 1);
    const magnitude = (Math.acos(widthRatio) * 180) / Math.PI;
    const zDelta = input.rightShoulder.z - input.leftShoulder.z;
    const signedYaw = zDelta >= 0 ? magnitude : -magnitude;
    const previous = input.previousYawDegrees;
    if (previous == null)
        return (0, geometry_1.normalizeDegrees)(signedYaw);
    const smoothing = (0, geometry_1.clamp)(input.smoothing ?? 0.35, 0, 1);
    return (0, geometry_1.normalizeDegrees)(previous * (1 - smoothing) + signedYaw * smoothing);
}
function angleIndexForDegrees(degrees) {
    const normalized = (0, geometry_1.normalizeDegrees)(degrees);
    return Math.round(normalized / 45) % constants_1.DRAPE_VISION_TARGET_ANGLES_DEGREES.length;
}
function targetAngleForIndex(index) {
    const normalizedIndex = ((index % constants_1.DRAPE_VISION_TARGET_ANGLES_DEGREES.length) + constants_1.DRAPE_VISION_TARGET_ANGLES_DEGREES.length) % constants_1.DRAPE_VISION_TARGET_ANGLES_DEGREES.length;
    return constants_1.DRAPE_VISION_TARGET_ANGLES_DEGREES[normalizedIndex];
}
