"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDrapePoseLandmarker = getDrapePoseLandmarker;
exports.initializeDrapePoseLandmarker = initializeDrapePoseLandmarker;
exports.detectPose = detectPose;
exports.clearDrapePoseLandmarker = clearDrapePoseLandmarker;
exports.getDrapeHandLandmarker = getDrapeHandLandmarker;
exports.initializeDrapeHandLandmarker = initializeDrapeHandLandmarker;
exports.detectHands = detectHands;
exports.clearDrapeHandLandmarker = clearDrapeHandLandmarker;
exports.getDrapeFaceLandmarker = getDrapeFaceLandmarker;
exports.initializeDrapeFaceLandmarker = initializeDrapeFaceLandmarker;
exports.detectFace = detectFace;
exports.clearDrapeFaceLandmarker = clearDrapeFaceLandmarker;
exports.getDrapeImageSegmenter = getDrapeImageSegmenter;
exports.initializeDrapeImageSegmenter = initializeDrapeImageSegmenter;
exports.segmentImage = segmentImage;
exports.clearDrapeImageSegmenter = clearDrapeImageSegmenter;
const react_native_nitro_modules_1 = require("react-native-nitro-modules");
let landmarker = null;
let handLandmarker = null;
let faceLandmarker = null;
let imageSegmenter = null;
function getDrapePoseLandmarker() {
    'worklet';
    if (!landmarker) {
        landmarker = react_native_nitro_modules_1.NitroModules.createHybridObject('DrapePoseLandmarker');
    }
    return landmarker;
}
function initializeDrapePoseLandmarker() {
    return getDrapePoseLandmarker().initialize();
}
function detectPose(frame, options) {
    'worklet';
    return getDrapePoseLandmarker().detectPose(frame, options);
}
function clearDrapePoseLandmarker() {
    landmarker?.clear();
    landmarker = null;
}
function getDrapeHandLandmarker() {
    'worklet';
    if (!handLandmarker) {
        handLandmarker = react_native_nitro_modules_1.NitroModules.createHybridObject('DrapeHandLandmarker');
    }
    return handLandmarker;
}
function initializeDrapeHandLandmarker() {
    return getDrapeHandLandmarker().initialize();
}
function detectHands(frame, options) {
    'worklet';
    return getDrapeHandLandmarker().detectHands(frame, options);
}
function clearDrapeHandLandmarker() {
    handLandmarker?.clear();
    handLandmarker = null;
}
function getDrapeFaceLandmarker() {
    'worklet';
    if (!faceLandmarker) {
        faceLandmarker = react_native_nitro_modules_1.NitroModules.createHybridObject('DrapeFaceLandmarker');
    }
    return faceLandmarker;
}
function initializeDrapeFaceLandmarker() {
    return getDrapeFaceLandmarker().initialize();
}
function detectFace(frame, options) {
    'worklet';
    return getDrapeFaceLandmarker().detectFace(frame, options);
}
function clearDrapeFaceLandmarker() {
    faceLandmarker?.clear();
    faceLandmarker = null;
}
function getDrapeImageSegmenter() {
    'worklet';
    if (!imageSegmenter) {
        imageSegmenter = react_native_nitro_modules_1.NitroModules.createHybridObject('DrapeImageSegmenter');
    }
    return imageSegmenter;
}
function initializeDrapeImageSegmenter() {
    return getDrapeImageSegmenter().initialize();
}
function segmentImage(frame, options) {
    'worklet';
    return getDrapeImageSegmenter().segment(frame, options);
}
function clearDrapeImageSegmenter() {
    imageSegmenter?.clear();
    imageSegmenter = null;
}
