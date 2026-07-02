"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confidenceFromScore = confidenceFromScore;
exports.combineCalibrationReferences = combineCalibrationReferences;
exports.calculateHeightCalibration = calculateHeightCalibration;
exports.estimatePosePixelHeight = estimatePosePixelHeight;
const constants_1 = require("./constants");
const geometry_1 = require("./geometry");
const POSE_HEIGHT_ROBUST_PERCENTILE = 0.75;
function confidenceFromScore(score) {
    if (score >= 0.85)
        return 'HIGH';
    if (score >= 0.65)
        return 'MEDIUM';
    return 'LOW';
}
function combineCalibrationReferences(references) {
    const valid = references.filter((ref) => Number.isFinite(ref.pixelToCm) && ref.pixelToCm > 0);
    if (valid.length === 0) {
        throw new Error('At least one calibration reference is required.');
    }
    const pixelToCm = valid.reduce((sum, ref) => sum + ref.pixelToCm, 0) / valid.length;
    const confidenceScore = valid.reduce((sum, ref) => sum + ref.confidence, 0) / valid.length;
    return {
        pixelToCm,
        confidence: confidenceFromScore(confidenceScore),
        references: valid,
    };
}
function calculateHeightCalibration(input) {
    if (!Number.isFinite(input.statedHeightCm) || input.statedHeightCm <= 0) {
        throw new Error('Stated height must be a positive number.');
    }
    const references = [];
    if (input.bodyPixelHeight && input.bodyPixelHeight > 0) {
        references.push({
            method: 'body_extent',
            pixelToCm: input.statedHeightCm / input.bodyPixelHeight,
            confidence: 0.9,
        });
    }
    else {
        const poseReference = estimatePoseCalibrationReference(input);
        if (poseReference)
            references.push(poseReference);
    }
    if (input.doorFramePixelHeight && input.doorFramePixelHeight > 0) {
        references.push({
            method: 'door_frame',
            pixelToCm: constants_1.DRAPE_VISION_DOOR_FRAME_HEIGHT_CM / input.doorFramePixelHeight,
            confidence: 0.85,
        });
    }
    return combineCalibrationReferences(references);
}
function estimatePoseCalibrationReference(input) {
    const frames = collectCalibrationFrames(input);
    const poseHeights = frames
        .map((frame) => estimatePosePixelHeight(frame))
        .filter((height) => typeof height === 'number' && Number.isFinite(height) && height > 0);
    if (poseHeights.length === 0)
        return null;
    const sorted = [...poseHeights].sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    const selectedHeight = percentile(sorted, POSE_HEIGHT_ROBUST_PERCENTILE);
    const spreadRatio = median > 0 ? (sorted[sorted.length - 1] - sorted[0]) / median : 1;
    return {
        method: 'pose_extent',
        pixelToCm: input.statedHeightCm / selectedHeight,
        confidence: poseHeightConfidence(poseHeights.length, spreadRatio),
        sampleCount: poseHeights.length,
        spreadRatio,
    };
}
function collectCalibrationFrames(input) {
    const frames = [];
    const seen = new Set();
    for (const frame of input.landmarkFrames ?? []) {
        if (!seen.has(frame)) {
            frames.push(frame);
            seen.add(frame);
        }
    }
    if (input.landmarks && !seen.has(input.landmarks)) {
        frames.push(input.landmarks);
    }
    return frames;
}
function percentile(sortedValues, percentileValue) {
    if (sortedValues.length === 0) {
        throw new Error('At least one value is required.');
    }
    const bounded = Math.max(0, Math.min(1, percentileValue));
    const index = Math.round((sortedValues.length - 1) * bounded);
    return sortedValues[index];
}
function poseHeightConfidence(sampleCount, spreadRatio) {
    if (sampleCount >= 4 && spreadRatio <= 0.08)
        return 0.72;
    if (sampleCount >= 3 && spreadRatio <= 0.08)
        return 0.68;
    if (sampleCount >= 3 && spreadRatio <= 0.14)
        return 0.62;
    if (sampleCount >= 2 && spreadRatio <= 0.12)
        return 0.58;
    return 0.52;
}
function estimatePosePixelHeight(landmarks) {
    if (!landmarks)
        return null;
    const candidates = [];
    const nose = landmarks[constants_1.DRAPE_VISION_LANDMARK.nose];
    const leftAnkle = landmarks[constants_1.DRAPE_VISION_LANDMARK.leftAnkle];
    const rightAnkle = landmarks[constants_1.DRAPE_VISION_LANDMARK.rightAnkle];
    if (nose &&
        leftAnkle &&
        rightAnkle &&
        (0, geometry_1.landmarkWeight)(nose) >= 0.4 &&
        (0, geometry_1.landmarkWeight)(leftAnkle) >= 0.4 &&
        (0, geometry_1.landmarkWeight)(rightAnkle) >= 0.4) {
        candidates.push((0, geometry_1.distance2D)(nose, (0, geometry_1.midpoint)(leftAnkle, rightAnkle)));
    }
    const headToAnkleHeight = estimateHeadToAnkleHeight(landmarks);
    if (headToAnkleHeight)
        candidates.push(headToAnkleHeight);
    const shoulderToAnkleHeight = estimateShoulderToAnkleBodyHeight(landmarks);
    if (shoulderToAnkleHeight)
        candidates.push(shoulderToAnkleHeight);
    if (candidates.length === 0)
        return null;
    return Math.max(...candidates);
}
function estimateHeadToAnkleHeight(landmarks) {
    const headAnchors = [
        landmarks[constants_1.DRAPE_VISION_LANDMARK.nose],
        landmarks[constants_1.DRAPE_VISION_LANDMARK.leftEar],
        landmarks[constants_1.DRAPE_VISION_LANDMARK.rightEar],
    ].filter((landmark) => isUsableCalibrationLandmark(landmark));
    const ankleAnchors = [
        landmarks[constants_1.DRAPE_VISION_LANDMARK.leftAnkle],
        landmarks[constants_1.DRAPE_VISION_LANDMARK.rightAnkle],
    ].filter((landmark) => isUsableCalibrationLandmark(landmark));
    if (headAnchors.length === 0 || ankleAnchors.length === 0)
        return null;
    const topY = Math.min(...headAnchors.map((landmark) => landmark.y));
    const bottomY = Math.max(...ankleAnchors.map((landmark) => landmark.y));
    const height = bottomY - topY;
    return Number.isFinite(height) && height > 0 ? height : null;
}
function estimateShoulderToAnkleBodyHeight(landmarks) {
    const leftShoulder = landmarks[constants_1.DRAPE_VISION_LANDMARK.leftShoulder];
    const rightShoulder = landmarks[constants_1.DRAPE_VISION_LANDMARK.rightShoulder];
    const ankleAnchors = [
        landmarks[constants_1.DRAPE_VISION_LANDMARK.leftAnkle],
        landmarks[constants_1.DRAPE_VISION_LANDMARK.rightAnkle],
    ].filter((landmark) => isUsableCalibrationLandmark(landmark));
    if (!isUsableCalibrationLandmark(leftShoulder) ||
        !isUsableCalibrationLandmark(rightShoulder) ||
        ankleAnchors.length === 0) {
        return null;
    }
    const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const ankleY = Math.max(...ankleAnchors.map((landmark) => landmark.y));
    const shoulderToAnkle = ankleY - shoulderY;
    if (!Number.isFinite(shoulderToAnkle) || shoulderToAnkle <= 0)
        return null;
    return shoulderToAnkle / 0.78;
}
function isUsableCalibrationLandmark(landmark) {
    return !!landmark &&
        Number.isFinite(landmark.x) &&
        Number.isFinite(landmark.y) &&
        (0, geometry_1.landmarkWeight)(landmark) >= 0.25;
}
