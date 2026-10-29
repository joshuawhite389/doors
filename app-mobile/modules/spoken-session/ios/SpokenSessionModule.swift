import AVFoundation
import ExpoModulesCore

// The tap-to-talk mic (src/mic.ts) records through expo-audio, which switches the session to playAndRecord. When it has
// the words, this puts back exactly what the AppDelegate set at launch (app.config.js withSpokenAudio): playback in the
// spoken-audio mode, mixing with music and pausing a podcast while Doors talks, playing with the silent switch on.
// expo-audio's own setAudioModeAsync can only give plain playback (no spoken-audio mode, no podcast pause).
public class SpokenSessionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SpokenSession")
    Function("restore") { () -> Bool in
      do {
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.mixWithOthers, .interruptSpokenAudioAndMixWithOthers])
        return true
      } catch {
        return false
      }
    }
    Function("category") { () -> String in
      let s = AVAudioSession.sharedInstance()
      return "\(s.category.rawValue)|\(s.mode.rawValue)"
    }
  }
}
