"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clamp = clamp;
exports.degreesToRadians = degreesToRadians;
exports.normalizeDegrees = normalizeDegrees;
exports.distance2D = distance2D;
exports.distance3D = distance3D;
exports.midpoint = midpoint;
exports.landmarkWeight = landmarkWeight;
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function degreesToRadians(degrees) {
    return (degrees * Math.PI) / 180;
}
function normalizeDegrees(degrees) {
    return ((degrees % 360) + 360) % 360;
}
function distance2D(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}
function distance3D(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function midpoint(a, b) {
    return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        z: (a.z + b.z) / 2,
        visibility: averageOptional(a.visibility, b.visibility),
        presence: averageOptional(a.presence, b.presence),
    };
}
function landmarkWeight(landmark) {
    if (!landmark)
        return 0;
    return clamp(landmark.visibility ?? 1, 0, 1) * clamp(landmark.presence ?? 1, 0, 1);
}
function averageOptional(a, b) {
    if (a == null && b == null)
        return undefined;
    if (a == null)
        return b;
    if (b == null)
        return a;
    return (a + b) / 2;
}
