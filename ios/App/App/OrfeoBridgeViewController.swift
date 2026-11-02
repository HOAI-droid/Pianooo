import UIKit
import Capacitor

/// The app's web view. Registers the app's own native plugins (npm plugins
/// are registered by Capacitor itself).
class OrfeoBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(OrfeoMidiPlugin())
        // A piano app: no rubber-banding or pinch zoom of the whole page
        webView?.scrollView.bounces = false
        webView?.scrollView.pinchGestureRecognizer?.isEnabled = false
    }

    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var prefersStatusBarHidden: Bool { true }
}
