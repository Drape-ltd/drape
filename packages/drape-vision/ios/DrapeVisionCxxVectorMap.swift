import NitroModules

private typealias DrapeVisionBridge = margelo.nitro.drape.vision.bridge.swift

extension DrapeVisionBridge.std__vector_VisionLandmark_ {
  func map<T>(_ transform: (VisionLandmark) throws -> T) rethrows -> [T] {
    var values: [T] = []
    values.reserveCapacity(Int(self.size()))

    for index in 0..<Int(self.size()) {
      values.append(try transform(self[index]))
    }

    return values
  }
}

extension DrapeVisionBridge.std__vector_VisionFaceBlendshape_ {
  func map<T>(_ transform: (VisionFaceBlendshape) throws -> T) rethrows -> [T] {
    var values: [T] = []
    values.reserveCapacity(Int(self.size()))

    for index in 0..<Int(self.size()) {
      values.append(try transform(self[index]))
    }

    return values
  }
}

extension DrapeVisionBridge.std__vector_VisionHandDetection_ {
  func map<T>(_ transform: (VisionHandDetection) throws -> T) rethrows -> [T] {
    var values: [T] = []
    values.reserveCapacity(Int(self.size()))

    for index in 0..<Int(self.size()) {
      values.append(try transform(self[index]))
    }

    return values
  }
}
