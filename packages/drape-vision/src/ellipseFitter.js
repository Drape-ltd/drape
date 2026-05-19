"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ramanujanCircumference = ramanujanCircumference;
exports.projectedEllipseWidth = projectedEllipseWidth;
exports.fitEllipseFromWidths = fitEllipseFromWidths;
const geometry_1 = require("./geometry");
function ramanujanCircumference(semiMajor, semiMinor) {
    if (semiMajor <= 0 || semiMinor <= 0) {
        throw new Error('Ellipse axes must be positive.');
    }
    const h = ((semiMajor - semiMinor) / (semiMajor + semiMinor)) ** 2;
    return Math.PI * (semiMajor + semiMinor) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}
function projectedEllipseWidth(semiMajor, semiMinor, angleDegrees) {
    if (semiMajor <= 0 || semiMinor <= 0) {
        throw new Error('Ellipse axes must be positive.');
    }
    const theta = (0, geometry_1.degreesToRadians)(angleDegrees);
    const radius = Math.sqrt(semiMajor ** 2 * Math.cos(theta) ** 2 +
        semiMinor ** 2 * Math.sin(theta) ** 2);
    return radius * 2;
}
function fitEllipseFromWidths(samples) {
    const validSamples = samples.filter((sample) => Number.isFinite(sample.width) && sample.width > 0);
    if (validSamples.length < 3) {
        throw new Error('At least 3 positive width samples are required to fit an ellipse.');
    }
    let s11 = 0;
    let s12 = 0;
    let s22 = 0;
    let b1 = 0;
    let b2 = 0;
    for (const sample of validSamples) {
        const theta = (0, geometry_1.degreesToRadians)(sample.angleDegrees);
        const x1 = Math.cos(theta) ** 2;
        const x2 = Math.sin(theta) ** 2;
        const y = (sample.width / 2) ** 2;
        const weight = sample.weight ?? 1;
        s11 += weight * x1 * x1;
        s12 += weight * x1 * x2;
        s22 += weight * x2 * x2;
        b1 += weight * x1 * y;
        b2 += weight * x2 * y;
    }
    const determinant = s11 * s22 - s12 * s12;
    if (Math.abs(determinant) < Number.EPSILON) {
        throw new Error('Width samples do not span enough angles to fit an ellipse.');
    }
    const axis0Squared = (b1 * s22 - b2 * s12) / determinant;
    const axis90Squared = (s11 * b2 - s12 * b1) / determinant;
    if (axis0Squared <= 0 || axis90Squared <= 0) {
        throw new Error('Width samples produced invalid ellipse axes.');
    }
    const axisAt0Degrees = Math.sqrt(axis0Squared);
    const axisAt90Degrees = Math.sqrt(axis90Squared);
    const semiMajor = Math.max(axisAt0Degrees, axisAt90Degrees);
    const semiMinor = Math.min(axisAt0Degrees, axisAt90Degrees);
    let squaredResidual = 0;
    for (const sample of validSamples) {
        const predicted = projectedEllipseWidth(axisAt0Degrees, axisAt90Degrees, sample.angleDegrees);
        squaredResidual += (predicted - sample.width) ** 2;
    }
    return {
        semiMajor,
        semiMinor,
        axisAt0Degrees,
        axisAt90Degrees,
        circumference: ramanujanCircumference(semiMajor, semiMinor),
        rmsError: Math.sqrt(squaredResidual / validSamples.length),
        sampleCount: validSamples.length,
    };
}
