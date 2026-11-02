import UIKit
import Capacitor

/// The app's web view. Registers the app's own native plugins (npm plugins
/// are registered by Capacitor itself).
class PianoooBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PianoooMidiPlugin())
        bridge?.registerPluginInstance(PianoooFilesPlugin())
        // A piano app: no rubber-banding or pinch zoom of the whole page
        webView?.scrollView.bounces = false
        webView?.scrollView.pinchGestureRecognizer?.isEnabled = false
    }
}
