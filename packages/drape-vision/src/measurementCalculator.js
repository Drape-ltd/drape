"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDrapeVisionMeasurements = calculateDrapeVisionMeasurements;
const constants_1 = require("./constants");
const calibration_1 = require("./calibration");
const ellipseFitter_1 = require("./ellipseFitter");
const geometry_1 = require("./geometry");
const CIRCUMFERENCE_FIELDS = [
    'chest',
    'waist',
    'hips',
    'thighCircumference',
    'kneeCircumference',
];
const EXTREME_LOW_RANGE_FACTOR = 0.45;
const EXTREME_HIGH_RANGE_FACTOR = 1.45;
const MAX_ACCEPTED_CIRCUMFERENCE_RESIDUAL_RATIO = 0.12;
const MAX_BODY_HEIGHT_SPREAD_RATIO = 0.18;
const MIN_BODY_HEIGHT_STABILITY_SAMPLES = 3;
const MIN_ROBUST_FIT_SAMPLE_COUNT = 5;
const MIN_ROBUST_RESIDUAL_IMPROVEMENT_RATIO = 0.65;
const MIN_UNIQUE_HALF_TURN_ANGLES = 3;
const MAX_HALF_TURN_ANGLE_GAP_DEGREES = 80;
const RELATIVE_CIRCUMFERENCE_LIMITS = {
    chest: { shoulderRatio: 3.25, heightRatio: 0.95 },
    waist: { shoulderRatio: 2.55, heightRatio: 0.72 },
    hips: { shoulderRatio: 3.25, heightRatio: 0.95 },
};
const DIRECT_MEASUREMENTS = [
    {
        field: 'shoulderWidth',
        measure: (landmarks) => distanceBetween(landmarks, constants_1.DRAPE_VISION_LANDMARK.leftShoulder, constants_1.DRAPE_VISION_LANDMARK.rightShoulder),
    },
    {
        field: 'sleeveLength',
        measure: (landmarks) => averageChains([
            [constants_1.DRAPE_VISION_LANDMARK.leftShoulder, constants_1.DRAPE_VISION_LANDMARK.leftElbow, constants_1.DRAPE_VISION_LANDMARK.leftWrist],
            [constants_1.DRAPE_VISION_LANDMARK.rightShoulder, constants_1.DRAPE_VISION_LANDMARK.rightElbow, constants_1.DRAPE_VISION_LANDMARK.rightWrist],
        ], landmarks),
    },
    {
        field: 'backLength',
        measure: (landmarks) => {
            const shoulders = midpointByIndex(landmarks, constants_1.DRAPE_VISION_LANDMARK.leftShoulder, constants_1.DRAPE_VISION_LANDMARK.rightShoulder);
            const hips = midpointByIndex(landmarks, constants_1.DRAPE_VISION_LANDMARK.leftHip, constants_1.DRAPE_VISION_LANDMARK.rightHip);
            if (!shoulders || !hips)
                return null;
            return {
                pixels: (0, geometry_1.distance2D)(shoulders.point, hips.point),
                confidence: Math.min(shoulders.confidence, hips.confidence),
            };
        },
    },
    {
        field: 'torsoLength',
        measure: (landmarks) => {
            const shoulders = midpointByIndex(landmarks, constants_1.DRAPE_VISION_LANDMARK.leftShoulder, constants_1.DRAPE_VISION_LANDMARK.rightShoulder);
            const hips = midpointByIndex(landmarks, constants_1.DRAPE_VISION_LANDMARK.leftHip, constants_1.DRAPE_VISION_LANDMARK.rightHip);
            if (!shoulders || !hips)
                return null;
            return {
                pixels: (0, geometry_1.distance2D)(shoulders.point, hips.point),
                confidence: Math.min(shoulders.confidence, hips.confidence),
            };
        },
    },
];
function calculateDrapeVisionMeasurements(input) {
    const calibration = (0, calibration_1.calculateHeightCalibration)({
        statedHeightCm: input.statedHeightCm,
        bodyPixelHeight: input.bodyPixelHeight,
        doorFramePixelHeight: input.doorFramePixelHeight,
        landmarks: selectFrontCapture(input.captures)?.landmarks,
    });
    const scale = calibration.pixelToCm;
    const measurements = {
        unit: 'cm',
        height: roundCm(input.statedHeightCm),
    };
    const confidenceByField = {
        height: calibration.confidence,
    };
    const warnings = [];
    const frontCapture = selectFrontCapture(input.captures);
    const directDiagnostics = [];
    const circumferenceDiagnostics = [];
    const scanQuality = calculateScanQuality(input.captures);
    if (frontCapture) {
        for (const spec of DIRECT_MEASUREMENTS) {
            const measured = spec.measure(frontCapture.landmarks);
            if (!measured) {
                directDiagnostics.push({
                    field: spec.field,
                    accepted: false,
                    rejectionReason: 'missing_landmarks',
                });
                continue;
            }
            const value = roundCm(measured.pixels * scale);
            if (isExtremeMeasurementOutlier(spec.field, value)) {
                warnings.push(`${spec.field} could not be estimated reliably.`);
                directDiagnostics.push({
                    field: spec.field,
                    pixels: roundDiagnosticNumber(measured.pixels),
                    valueCm: value,
                    confidenceScore: roundDiagnosticNumber(Math.min(measured.confidence, calibrationConfidenceScore(calibration))),
                    accepted: false,
                    rejectionReason: 'extreme_outlier',
                });
                continue;
            }
            measurements[spec.field] = value;
            const confidenceScoreValue = Math.min(measured.confidence, calibrationConfidenceScore(calibration));
            confidenceByField[spec.field] = (0, calibration_1.confidenceFromScore)(confidenceScoreValue);
            directDiagnostics.push({
                field: spec.field,
                pixels: roundDiagnosticNumber(measured.pixels),
                valueCm: value,
                confidenceScore: roundDiagnosticNumber(confidenceScoreValue),
                accepted: true,
            });
        }
    }
    for (const field of CIRCUMFERENCE_FIELDS) {
        const sampleDiagnostics = input.captures.map((capture) => {
            const widthPx = capture.segmentWidthsPx?.[field];
            const normalized = normalizeSegmentWidth(widthPx, capture, !!input.bodyPixelHeight);
            const width = normalized.normalizedWidth != null ? normalized.normalizedWidth * scale : null;
            const base = {
                angleIndex: capture.angleIndex,
                angleDegrees: capture.angleDegrees,
                frameWidthPx: roundDiagnosticNumber(capture.frameWidthPx),
                widthPx: roundDiagnosticNumber(widthPx),
                normalizedWidth: roundDiagnosticNumber(normalized.normalizedWidth),
                widthCm: roundDiagnosticNumber(width),
                normalization: normalized.normalization,
            };
            if (!width) {
                return {
                    ...base,
                    accepted: false,
                    rejectionReason: normalized.rejectionReason,
                };
            }
            if (!isPlausibleProjectedWidth(field, width)) {
                return {
                    ...base,
                    accepted: false,
                    rejectionReason: 'implausible_projected_width',
                };
            }
            return {
                ...base,
                accepted: true,
            };
        });
        const samples = sampleDiagnostics
            .map((sample, sampleDiagnosticIndex) => ({ sample, sampleDiagnosticIndex }))
            .filter((entry) => (entry.sample.accepted && typeof entry.sample.widthCm === 'number'))
            .map((entry) => ({
            angleDegrees: entry.sample.angleDegrees,
            width: entry.sample.widthCm,
            sampleDiagnosticIndex: entry.sampleDiagnosticIndex,
        }));
        const diagnostic = {
            field,
            samples: sampleDiagnostics,
            acceptedSampleCount: samples.length,
            rejectedSampleCount: sampleDiagnostics.length - samples.length,
            accepted: false,
        };
        if (samples.length >= 3) {
            try {
                if (!scanQuality.accepted) {
                    diagnostic.rejectionReason = 'unstable_body_height';
                    warnings.push(`${field} could not be estimated reliably.`);
                    circumferenceDiagnostics.push(diagnostic);
                    continue;
                }
                if (!hasSufficientAngleCoverage(samples)) {
                    diagnostic.rejectionReason = 'insufficient_angle_coverage';
                    warnings.push(`${field} could not be estimated reliably.`);
                    circumferenceDiagnostics.push(diagnostic);
                    continue;
                }
                const fitAttempt = fitCircumferenceSamples(samples);
                const { ellipse, residualRatio, excludedSampleIndexes } = fitAttempt;
                const circumference = roundCm(fitAttempt.circumference);
                for (const sampleIndex of excludedSampleIndexes) {
                    const sample = sampleDiagnostics[sampleIndex];
                    sampleDiagnostics[sampleIndex] = {
                        ...sample,
                        accepted: false,
                        rejectionReason: 'robust_fit_outlier',
                    };
                }
                diagnostic.acceptedSampleCount = samples.length - excludedSampleIndexes.length;
                diagnostic.rejectedSampleCount = sampleDiagnostics.length - diagnostic.acceptedSampleCount;
                diagnostic.fit = {
                    sampleCount: ellipse.sampleCount,
                    semiMajorCm: roundDiagnosticNumber(ellipse.semiMajor) ?? 0,
                    semiMinorCm: roundDiagnosticNumber(ellipse.semiMinor) ?? 0,
                    axisAt0DegreesCm: roundDiagnosticNumber(ellipse.axisAt0Degrees) ?? 0,
                    axisAt90DegreesCm: roundDiagnosticNumber(ellipse.axisAt90Degrees) ?? 0,
                    circumferenceCm: circumference,
                    rmsErrorCm: roundDiagnosticNumber(ellipse.rmsError) ?? 0,
                    residualRatio: roundDiagnosticNumber(residualRatio) ?? 1,
                    initialResidualRatio: roundDiagnosticNumber(fitAttempt.initialResidualRatio),
                    excludedSampleCount: excludedSampleIndexes.length || undefined,
                };
                if (isExtremeMeasurementOutlier(field, circumference)) {
                    diagnostic.rejectionReason = 'extreme_outlier';
                    warnings.push(`${field} could not be estimated reliably.`);
                    circumferenceDiagnostics.push(diagnostic);
                    continue;
                }
                if (residualRatio > MAX_ACCEPTED_CIRCUMFERENCE_RESIDUAL_RATIO) {
                    diagnostic.rejectionReason = 'poor_fit_residual';
                    warnings.push(`${field} could not be estimated reliably.`);
                    circumferenceDiagnostics.push(diagnostic);
                    continue;
                }
                if (isRelativeCircumferenceOutlier(field, circumference, measurements)) {
                    diagnostic.rejectionReason = 'relative_outlier';
                    warnings.push(`${field} could not be estimated reliably.`);
                    circumferenceDiagnostics.push(diagnostic);
                    continue;
                }
                measurements[field] = circumference;
                confidenceByField[field] = (0, calibration_1.confidenceFromScore)(residualRatio < 0.03 ? 0.9 : residualRatio < 0.08 ? 0.75 : 0.6);
                diagnostic.accepted = true;
            }
            catch (error) {
                diagnostic.rejectionReason = 'ellipse_fit_failed';
                diagnostic.error = error instanceof Error ? error.message : String(error);
                warnings.push(`${field} could not be estimated reliably.`);
            }
        }
        else {
            diagnostic.rejectionReason = 'insufficient_samples';
            if (sampleDiagnostics.some((sample) => sample.rejectionReason && sample.rejectionReason !== 'missing_width')) {
                warnings.push(`${field} could not be estimated reliably.`);
            }
        }
        circumferenceDiagnostics.push(diagnostic);
    }
    for (const field of Object.keys(constants_1.DRAPE_VISION_MEASUREMENT_RANGES_CM)) {
        const value = measurements[field];
        if (typeof value !== 'number')
            continue;
        const range = constants_1.DRAPE_VISION_MEASUREMENT_RANGES_CM[field];
        if (range && (value < range.min || value > range.max)) {
            confidenceByField[field] = 'LOW';
            warnings.push(`${field} is outside expected range.`);
        }
    }
    return {
        measurements,
        confidenceByField,
        calibration,
        warnings,
        diagnostics: {
            version: 'drape-vision-measurement-diagnostics-v1',
            calibrationPixelToCm: roundDiagnosticNumber(calibration.pixelToCm) ?? calibration.pixelToCm,
            calibrationConfidence: calibration.confidence,
            captureCount: input.captures.length,
            scanQuality,
            direct: directDiagnostics,
            circumferences: circumferenceDiagnostics,
        },
    };
}
function calculateScanQuality(captures) {
    const bodyHeights = captures
        .map((capture) => estimateCaptureBodyHeight(capture.landmarks))
        .filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    const diagnostic = {
        accepted: true,
        bodyHeightSampleCount: bodyHeights.length,
        rejectionReasons: [],
    };
    if (bodyHeights.length >= MIN_BODY_HEIGHT_STABILITY_SAMPLES) {
        const sorted = [...bodyHeights].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const spreadRatio = median > 0 ? (sorted[sorted.length - 1] - sorted[0]) / median : 1;
        diagnostic.bodyHeightSpreadRatio = roundDiagnosticNumber(spreadRatio);
        if (spreadRatio > MAX_BODY_HEIGHT_SPREAD_RATIO) {
            diagnostic.accepted = false;
            diagnostic.rejectionReasons.push('unstable_body_height');
        }
    }
    return diagnostic;
}
function estimateCaptureBodyHeight(landmarks) {
    const nose = landmarks[constants_1.DRAPE_VISION_LANDMARK.nose];
    const leftAnkle = landmarks[constants_1.DRAPE_VISION_LANDMARK.leftAnkle];
    const rightAnkle = landmarks[constants_1.DRAPE_VISION_LANDMARK.rightAnkle];
    if (!nose || !leftAnkle || !rightAnkle)
        return null;
    if ((0, geometry_1.landmarkWeight)(nose) < 0.4 || (0, geometry_1.landmarkWeight)(leftAnkle) < 0.4 || (0, geometry_1.landmarkWeight)(rightAnkle) < 0.4)
        return null;
    return (0, geometry_1.distance2D)(nose, (0, geometry_1.midpoint)(leftAnkle, rightAnkle));
}
function fitCircumferenceSamples(samples) {
    const initial = fitCircumferenceSampleSet(samples, []);
    if (initial.residualRatio <= MAX_ACCEPTED_CIRCUMFERENCE_RESIDUAL_RATIO || samples.length < MIN_ROBUST_FIT_SAMPLE_COUNT) {
        return initial;
    }
    let best = initial;
    for (let index = 0; index < samples.length; index += 1) {
        const remainingSamples = samples.filter((_, sampleIndex) => sampleIndex !== index);
        if (remainingSamples.length < 3 || !hasSufficientAngleCoverage(remainingSamples))
            continue;
        try {
            const candidate = fitCircumferenceSampleSet(remainingSamples, [samples[index].sampleDiagnosticIndex], initial.residualRatio);
            if (candidate.residualRatio < best.residualRatio) {
                best = candidate;
            }
        }
        catch {
            // Leave-one-out candidates can be singular when the remaining angles collapse.
        }
    }
    if (best.excludedSampleIndexes.length > 0 &&
        best.residualRatio <= MAX_ACCEPTED_CIRCUMFERENCE_RESIDUAL_RATIO &&
        best.residualRatio <= initial.residualRatio * MIN_ROBUST_RESIDUAL_IMPROVEMENT_RATIO) {
        return best;
    }
    return initial;
}
function fitCircumferenceSampleSet(samples, excludedSampleIndexes, initialResidualRatio) {
    const ellipse = (0, ellipseFitter_1.fitEllipseFromWidths)(samples);
    const meanWidth = samples.reduce((sum, sample) => sum + sample.width, 0) / samples.length;
    const residualRatio = meanWidth > 0 ? ellipse.rmsError / meanWidth : 1;
    return {
        ellipse,
        circumference: ellipse.circumference,
        residualRatio,
        initialResidualRatio,
        excludedSampleIndexes,
    };
}
function selectFrontCapture(captures) {
    return [...captures].sort((a, b) => angleDistance(a.angleDegrees, 0) - angleDistance(b.angleDegrees, 0))[0] ?? null;
}
function angleDistance(a, b) {
    const diff = Math.abs((((a - b) % 360) + 540) % 360 - 180);
    return diff;
}
function hasSufficientAngleCoverage(samples) {
    const normalizedAngles = [...new Set(samples
            .map((sample) => (0, geometry_1.normalizeDegrees)(sample.angleDegrees) % 180)
            .map((angle) => Math.round(angle)))]
        .sort((a, b) => a - b);
    if (normalizedAngles.length < MIN_UNIQUE_HALF_TURN_ANGLES)
        return false;
    let largestGap = 0;
    for (let index = 0; index < normalizedAngles.length; index += 1) {
        const current = normalizedAngles[index];
        const next = normalizedAngles[(index + 1) % normalizedAngles.length];
        const gap = index === normalizedAngles.length - 1 ? next + 180 - current : next - current;
        largestGap = Math.max(largestGap, gap);
    }
    return largestGap <= MAX_HALF_TURN_ANGLE_GAP_DEGREES;
}
function distanceBetween(landmarks, aIndex, bIndex) {
    const a = landmarks[aIndex];
    const b = landmarks[bIndex];
    if (!a || !b)
        return null;
    return {
        pixels: (0, geometry_1.distance2D)(a, b),
        confidence: Math.min((0, geometry_1.landmarkWeight)(a), (0, geometry_1.landmarkWeight)(b)),
    };
}
function midpointByIndex(landmarks, aIndex, bIndex) {
    const a = landmarks[aIndex];
    const b = landmarks[bIndex];
    if (!a || !b)
        return null;
    return {
        point: (0, geometry_1.midpoint)(a, b),
        confidence: Math.min((0, geometry_1.landmarkWeight)(a), (0, geometry_1.landmarkWeight)(b)),
    };
}
function averageChains(chains, landmarks) {
    const measured = chains
        .map((chain) => measureChain(chain, landmarks))
        .filter((value) => !!value);
    if (measured.length === 0)
        return null;
    return {
        pixels: measured.reduce((sum, value) => sum + value.pixels, 0) / measured.length,
        confidence: measured.reduce((sum, value) => sum + value.confidence, 0) / measured.length,
    };
}
function measureChain(chain, landmarks) {
    let pixels = 0;
    let confidence = 1;
    for (let index = 1; index < chain.length; index += 1) {
        const segment = distanceBetween(landmarks, chain[index - 1], chain[index]);
        if (!segment)
            return null;
        pixels += segment.pixels;
        confidence = Math.min(confidence, segment.confidence);
    }
    return { pixels, confidence };
}
function calibrationConfidenceScore(calibration) {
    if (calibration.confidence === 'HIGH')
        return 0.9;
    if (calibration.confidence === 'MEDIUM')
        return 0.75;
    return 0.55;
}
function isPlausibleProjectedWidth(field, widthCm) {
    if (!Number.isFinite(widthCm) || widthCm <= 0)
        return false;
    const range = constants_1.DRAPE_VISION_MEASUREMENT_RANGES_CM[field];
    return widthCm >= range.min * 0.12 && widthCm <= range.max;
}
function normalizeSegmentWidth(widthPx, capture, allowCoordinateUnits = false) {
    if (!widthPx || widthPx <= 0) {
        return {
            normalizedWidth: undefined,
            normalization: undefined,
            rejectionReason: 'missing_width',
        };
    }
    if (widthPx <= 1.2) {
        return {
            normalizedWidth: widthPx,
            normalization: 'already_normalized',
            rejectionReason: undefined,
        };
    }
    if (allowCoordinateUnits) {
        return {
            normalizedWidth: widthPx,
            normalization: 'coordinate_units',
            rejectionReason: undefined,
        };
    }
    if (capture.frameWidthPx && capture.frameWidthPx > 0 && widthPx <= capture.frameWidthPx * 1.1) {
        return {
            normalizedWidth: widthPx / capture.frameWidthPx,
            normalization: 'frame_width',
            rejectionReason: undefined,
        };
    }
    return {
        normalizedWidth: undefined,
        normalization: undefined,
        rejectionReason: 'raw_width_without_frame',
    };
}
function isExtremeMeasurementOutlier(field, valueCm) {
    if (!Number.isFinite(valueCm) || valueCm <= 0)
        return true;
    const range = constants_1.DRAPE_VISION_MEASUREMENT_RANGES_CM[field];
    return valueCm < range.min * EXTREME_LOW_RANGE_FACTOR || valueCm > range.max * EXTREME_HIGH_RANGE_FACTOR;
}
function isRelativeCircumferenceOutlier(field, valueCm, measurements) {
    const limits = RELATIVE_CIRCUMFERENCE_LIMITS[field];
    if (!limits || !Number.isFinite(valueCm) || valueCm <= 0)
        return false;
    const shoulderWidth = measurements.shoulderWidth;
    if (typeof shoulderWidth === 'number' && shoulderWidth > 0 && valueCm > shoulderWidth * limits.shoulderRatio) {
        return true;
    }
    const height = measurements.height;
    if (typeof height === 'number' && height > 0 && valueCm > height * limits.heightRatio) {
        return true;
    }
    return false;
}
function roundDiagnosticNumber(value, decimals = 4) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return undefined;
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}
function roundCm(value) {
    return Math.round(value * 10) / 10;
}
