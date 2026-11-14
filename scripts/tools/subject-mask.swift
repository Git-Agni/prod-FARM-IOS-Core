// Subject mask with Apple Vision (macOS 14+): writes a grayscale PNG the size of the input, white = person.
// Used by render-devin-story.ts so orbit rings can pass behind the subject (Devin's frame 2 layering).
// Usage: swift scripts/tools/subject-mask.swift input.png output-mask.png
import Foundation
import Vision
import CoreImage
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let img = CIImage(contentsOf: URL(fileURLWithPath: args[1])) else { print("usage: in out"); exit(1) }
let req = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: img)
try handler.perform([req])
guard let obs = req.results?.first else { print("no subject"); exit(2) }
let buf = try obs.generateScaledMaskForImage(forInstances: obs.allInstances, from: handler)
let mask = CIImage(cvPixelBuffer: buf)
let ctx = CIContext()
let rep = NSBitmapImageRep(cgImage: ctx.createCGImage(mask, from: mask.extent)!)
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("ok \(Int(mask.extent.width))x\(Int(mask.extent.height))")
