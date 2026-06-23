import AVFoundation
import AppKit
import Foundation
import MediaPlayer

// A faceless macOS Now Playing bridge driven over stdio.
//
// Protocol:
//   stdin  — one JSON object per line describing what is playing:
//            {"title","artist","album","artworkUrl","duration","elapsed","rate","state"}
//   stdout — one JSON event per line when the user presses a Control Center button:
//            {"event":"play|pause|toggle|next|previous"}
//
// It owns the Now Playing slot by playing a silent looping audio buffer, then
// mirrors whatever metadata it is handed. It knows nothing about any specific app.

// MARK: - Silent audio to claim and hold the Now Playing slot

final class SilenceKeeper {
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()

  func start() {
    guard let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2),
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44_100)
    else {
      FileHandle.standardError.write(Data("could not allocate silent buffer\n".utf8))
      return
    }
    buffer.frameLength = buffer.frameCapacity

    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: format)

    do {
      try engine.start()
    } catch {
      FileHandle.standardError.write(Data("audio engine failed to start: \(error)\n".utf8))
      return
    }

    player.scheduleBuffer(buffer, at: nil, options: .loops, completionHandler: nil)
    player.play()
  }
}

// MARK: - Now Playing publisher + remote command relay

final class Bridge {
  private var loadedArtworkUrl: String?

  func registerRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()
    let commands: [(MPRemoteCommand, String)] = [
      (center.playCommand, "play"),
      (center.pauseCommand, "pause"),
      (center.togglePlayPauseCommand, "toggle"),
      (center.nextTrackCommand, "next"),
      (center.previousTrackCommand, "previous"),
    ]
    for (command, name) in commands {
      command.isEnabled = true
      command.addTarget { _ in
        print("{\"event\":\"\(name)\"}")
        return .success
      }
    }
  }

  func apply(_ command: [String: Any]) {
    var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
    if let title = command["title"] as? String { info[MPMediaItemPropertyTitle] = title }
    if let artist = command["artist"] as? String { info[MPMediaItemPropertyArtist] = artist }
    if let album = command["album"] as? String { info[MPMediaItemPropertyAlbumTitle] = album }
    if let duration = command["duration"] as? Double {
      info[MPMediaItemPropertyPlaybackDuration] = duration
    }
    if let elapsed = command["elapsed"] as? Double {
      info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
    }
    info[MPNowPlayingInfoPropertyPlaybackRate] = (command["rate"] as? Double) ?? 1.0
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info

    if let state = command["state"] as? String {
      MPNowPlayingInfoCenter.default().playbackState = state == "paused" ? .paused : .playing
    }

    if let artworkUrl = command["artworkUrl"] as? String, let url = URL(string: artworkUrl) {
      loadArtwork(from: url)
    }
  }

  private func loadArtwork(from url: URL) {
    guard loadedArtworkUrl != url.absoluteString else { return }
    loadedArtworkUrl = url.absoluteString
    URLSession.shared.dataTask(with: url) { data, _, _ in
      guard let data, let image = NSImage(data: data) else { return }
      let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
      DispatchQueue.main.async {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyArtwork] = artwork
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
      }
    }.resume()
  }
}

// MARK: - Line-buffered stdin reader

final class StdinReader {
  private var buffer = Data()
  private let onLine: ([String: Any]) -> Void

  init(onLine: @escaping ([String: Any]) -> Void) {
    self.onLine = onLine
  }

  func start() {
    FileHandle.standardInput.readabilityHandler = { [weak self] handle in
      guard let self else { return }
      let chunk = handle.availableData
      if chunk.isEmpty {
        exit(0)  // parent closed the pipe
      }
      self.buffer.append(chunk)
      while let newline = self.buffer.firstIndex(of: 0x0A) {
        let lineData = self.buffer.subdata(in: self.buffer.startIndex..<newline)
        self.buffer.removeSubrange(self.buffer.startIndex...newline)
        guard
          let object = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any]
        else { continue }
        DispatchQueue.main.async { self.onLine(object) }
      }
    }
  }
}

// MARK: - Entry point

setbuf(stdout, nil)

let bridge = Bridge()
SilenceKeeper().start()
bridge.registerRemoteCommands()

let reader = StdinReader { bridge.apply($0) }
reader.start()

RunLoop.main.run()
