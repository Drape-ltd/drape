"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDrapePoseLandmarker = getDrapePoseLandmarker;
exports.initializeDrapePoseLandmarker = initializeDrapePoseLandmarker;
exports.detectPose = detectPose;
exports.clearDrapePoseLandmarker = clearDrapePoseLandmarker;
const react_native_nitro_modules_1 = require("react-native-nitro-modules");
let landmarker = null;
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
