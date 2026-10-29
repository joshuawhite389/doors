import ExpoModulesCore
import UIKit

// iOS dictation inserts text into a UITextView without the delegate calls React Native listens to, so a long burst
// runs past the bottom of a fixed-height scrolling box and the caret goes out of sight (iPhone XS, 2026-10-22).
// This follows the text view being edited natively: on every text change, and on a light 5 Hz check of its text
// length and content height while it is first responder, it scrolls the caret into view. Nothing in JS is involved.
public class CaretFollowModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CaretFollow")
    OnCreate { DispatchQueue.main.async { CaretFollower.shared.start() } }
    Function("start") { DispatchQueue.main.async { CaretFollower.shared.start() } }
    // How many times it has scrolled a caret into view (a test can read it to prove the native path ran).
    Function("follows") { () -> Int in CaretFollower.shared.follows }
  }
}

final class CaretFollower: NSObject {
  static let shared = CaretFollower()
  private var started = false
  private weak var editing: UITextView?
  private var timer: Timer?
  private var lastLength = -1
  private var lastHeight: CGFloat = -1
  private(set) var follows = 0

  func start() {
    guard !started else { return }
    started = true
    let nc = NotificationCenter.default
    nc.addObserver(self, selector: #selector(began(_:)), name: UITextView.textDidBeginEditingNotification, object: nil)
    nc.addObserver(self, selector: #selector(ended(_:)), name: UITextView.textDidEndEditingNotification, object: nil)
    nc.addObserver(self, selector: #selector(changed(_:)), name: UITextView.textDidChangeNotification, object: nil)
  }

  @objc private func began(_ n: Notification) {
    guard let tv = n.object as? UITextView else { return }
    editing = tv
    lastLength = tv.textStorage.length
    lastHeight = tv.contentSize.height
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in self?.tick() }
  }

  @objc private func ended(_ n: Notification) {
    guard (n.object as? UITextView) === editing else { return }
    timer?.invalidate()
    timer = nil
    editing = nil
  }

  @objc private func changed(_ n: Notification) {
    guard let tv = n.object as? UITextView else { return }
    // Let layout catch up with the inserted text before measuring the caret.
    DispatchQueue.main.async { [weak self] in self?.follow(tv) }
  }

  private func tick() {
    guard let tv = editing, tv.isFirstResponder else { return }
    let length = tv.textStorage.length
    let height = tv.contentSize.height
    if length != lastLength || height != lastHeight { follow(tv) }
  }

  private func follow(_ tv: UITextView) {
    lastLength = tv.textStorage.length
    lastHeight = tv.contentSize.height
    guard tv.isScrollEnabled, tv.isFirstResponder, let range = tv.selectedTextRange else { return }
    tv.layoutManager.ensureLayout(for: tv.textContainer)
    let caret = tv.caretRect(for: range.end)
    guard !caret.isNull, !caret.isInfinite, caret.height > 0 else { return }
    let visible = tv.bounds.inset(by: tv.adjustedContentInset)
    if visible.contains(caret) { return }
    tv.scrollRectToVisible(caret.insetBy(dx: 0, dy: -6), animated: false)
    follows += 1
  }
}
