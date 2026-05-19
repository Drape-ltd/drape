"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confidenceFromScore = confidenceFromScore;
exports.combineCalibrationReferences = combineCalibrationReferences;
exports.calculateHeightCalibration = calculateHeightCalibration;
const constants_1 = require("./constants");
const geometry_1 = require("./geometry");
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
        const posePixelHeight = estimatePosePixelHeight(input.landmarks);
        if (posePixelHeight && posePixelHeight > 0) {
            references.push({
                method: 'pose_extent',
                pixelToCm: input.statedHeightCm / posePixelHeight,
                confidence: 0.55,
            });
        }
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
function estimatePosePixelHeight(landmarks) {
    if (!landmarks)
        return null;
    const nose = landmarks[constants_1.DRAPE_VISION_LANDMARK.nose];
    const leftAnkle = landmarks[constants_1.DRAPE_VISION_LANDMARK.leftAnkle];
    const rightAnkle = landmarks[constants_1.DRAPE_VISION_LANDMARK.rightAnkle];
    if (!nose || !leftAnkle || !rightAnkle)
        return null;
    if ((0, geometry_1.landmarkWeight)(nose) < 0.4 || (0, geometry_1.landmarkWeight)(leftAnkle) < 0.4 || (0, geometry_1.landmarkWeight)(rightAnkle) < 0.4) {
        return null;
    }
    return (0, geometry_1.distance2D)(nose, (0, geometry_1.midpoint)(leftAnkle, rightAnkle));
}
