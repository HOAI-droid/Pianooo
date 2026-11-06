package com.hoaidroid.pianooo;

import android.Manifest;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiInputPort;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.widget.ArrayAdapter;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * MIDI for the Android app. Android's web view has no Web MIDI, so this plugin
 * talks to android.media.midi: USB keyboards and Bluetooth LE MIDI keyboards
 * (such as the Kawai ES120) are listened to, and every MIDI destination can be
 * played into. src/platform/ipad/webMidi.ts presents it to the web app as the
 * standard Web MIDI API — the same JavaScript side as the iPad's CoreMIDI plugin.
 *
 * Bluetooth keyboards are found with a short scan for the Bluetooth MIDI
 * service and connected from a list (showBluetoothPairing).
 */
@CapacitorPlugin(
    name = "PianoooMidi",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class PianoooMidiPlugin extends Plugin {

    private static final UUID MIDI_SERVICE = UUID.fromString("03B80E5A-EDE8-4B33-A751-6CE34EC4C700");
    private static final long SCAN_MS = 12000;

    private MidiManager midi;
    private final Handler main = new Handler(Looper.getMainLooper());

    /** Open devices by MidiDeviceInfo id */
    private final Map<Integer, MidiDevice> devices = new ConcurrentHashMap<>();
    /** Ports we listen to (the device's output ports) and play into (its input ports) */
    private final Map<String, MidiOutputPort> sources = new ConcurrentHashMap<>();
    private final Map<String, MidiInputPort> destinations = new ConcurrentHashMap<>();
    private final Map<String, String> names = new ConcurrentHashMap<>();
    private final Map<String, String> makers = new ConcurrentHashMap<>();
    /** Bluetooth devices opened from the pairing list — kept so the link stays up */
    private final List<MidiDevice> bluetooth = Collections.synchronizedList(new ArrayList<>());

    private final MidiManager.DeviceCallback deviceCallback = new MidiManager.DeviceCallback() {
        @Override public void onDeviceAdded(MidiDeviceInfo info) { openDevice(info); }
        @Override public void onDeviceRemoved(MidiDeviceInfo info) { closeDevice(info.getId()); changed(); }
    };

    @Override
    public void load() {
        Context ctx = getContext();
        if (!ctx.getPackageManager().hasSystemFeature(PackageManager.FEATURE_MIDI)) return;
        midi = (MidiManager) ctx.getSystemService(Context.MIDI_SERVICE);
        if (midi == null) return;
        midi.registerDeviceCallback(deviceCallback, main);
        for (MidiDeviceInfo info : midi.getDevices()) openDevice(info);
    }

    @Override
    protected void handleOnDestroy() {
        if (midi != null) midi.unregisterDeviceCallback(deviceCallback);
        for (Integer id : new ArrayList<>(devices.keySet())) closeDevice(id);
        synchronized (bluetooth) {
            for (MidiDevice d : bluetooth) { try { d.close(); } catch (IOException ignored) {} }
            bluetooth.clear();
        }
    }

    private void changed() { notifyListeners("devicesChanged", new JSObject()); }

    // ── Devices ─────────────────────────────────────────────────────────────
    private void openDevice(MidiDeviceInfo info) {
        if (midi == null || devices.containsKey(info.getId())) return;
        midi.openDevice(info, device -> {
            if (device != null) addDevice(device);
        }, main);
    }

    private void addDevice(MidiDevice device) {
        MidiDeviceInfo info = device.getInfo();
        int id = info.getId();
        if (devices.containsKey(id)) return;
        devices.put(id, device);
        Bundle props = info.getProperties();
        String name = props.getString(MidiDeviceInfo.PROPERTY_NAME);
        if (name == null || name.isEmpty()) name = props.getString(MidiDeviceInfo.PROPERTY_PRODUCT, "MIDI");
        String maker = props.getString(MidiDeviceInfo.PROPERTY_MANUFACTURER, "");
        int outs = info.getOutputPortCount(), ins = info.getInputPortCount();
        for (MidiDeviceInfo.PortInfo port : info.getPorts()) {
            int n = port.getPortNumber();
            String label = name;
            String portName = port.getName();
            int count = port.getType() == MidiDeviceInfo.PortInfo.TYPE_OUTPUT ? outs : ins;
            if (count > 1) label = name + (portName != null && !portName.isEmpty() ? " " + portName : " " + (n + 1));
            if (port.getType() == MidiDeviceInfo.PortInfo.TYPE_OUTPUT) {
                MidiOutputPort out = device.openOutputPort(n);
                if (out == null) continue;
                String key = "d" + id + "o" + n;
                out.connect(new Framer(key));
                sources.put(key, out);
                names.put(key, label); makers.put(key, maker);
            } else {
                MidiInputPort in = device.openInputPort(n);
                if (in == null) continue;
                String key = "d" + id + "i" + n;
                destinations.put(key, in);
                names.put(key, label); makers.put(key, maker);
            }
        }
        changed();
    }

    private void closeDevice(int id) {
        String prefix = "d" + id;
        for (String key : new ArrayList<>(sources.keySet())) {
            if (key.startsWith(prefix + "o")) { try { sources.remove(key).close(); } catch (IOException ignored) {} }
        }
        for (String key : new ArrayList<>(destinations.keySet())) {
            if (key.startsWith(prefix + "i")) { try { destinations.remove(key).close(); } catch (IOException ignored) {} }
        }
        MidiDevice d = devices.remove(id);
        if (d != null) { try { d.close(); } catch (IOException ignored) {} }
    }

    @PluginMethod
    public void listDevices(PluginCall call) {
        JSArray inputs = new JSArray(), outputs = new JSArray();
        for (String key : sources.keySet()) inputs.put(endpoint(key));
        for (String key : destinations.keySet()) outputs.put(endpoint(key));
        JSObject ret = new JSObject();
        ret.put("inputs", inputs);
        ret.put("outputs", outputs);
        call.resolve(ret);
    }

    private JSObject endpoint(String key) {
        JSObject o = new JSObject();
        o.put("id", key);
        o.put("name", names.getOrDefault(key, "MIDI"));
        o.put("manufacturer", makers.getOrDefault(key, ""));
        return o;
    }

    @PluginMethod
    public void send(PluginCall call) {
        String id = call.getString("id");
        JSArray data = call.getArray("data");
        MidiInputPort port = id == null ? null : destinations.get(id);
        if (port == null || data == null) { call.resolve(); return; }
        try {
            byte[] bytes = new byte[data.length()];
            for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) data.getInt(i);
            port.send(bytes, 0, bytes.length);
        } catch (JSONException | IOException ignored) {}
        call.resolve();
    }

    // ── Incoming bytes → single MIDI messages (running status, SysEx skipped) ──
    private class Framer extends MidiReceiver {
        private final String id;
        private int status = 0, needed = 0, have = 0;
        private final int[] buf = new int[3];
        private boolean sysex = false;

        Framer(String id) { this.id = id; }

        @Override
        public void onSend(byte[] msg, int offset, int count, long timestamp) {
            for (int i = offset; i < offset + count; i++) {
                int b = msg[i] & 0xFF;
                if (b >= 0xF8) { emit(new int[] { b }, 1); continue; }   // real-time
                if (b == 0xF0) { sysex = true; continue; }
                if (b == 0xF7) { sysex = false; continue; }
                if (sysex) { if (b < 0x80) continue; sysex = false; }
                if (b >= 0x80) {
                    status = b; have = 0;
                    buf[0] = b;
                    needed = dataBytes(b);
                    if (needed == 0) { emit(buf, 1); status = 0; }
                } else if (status != 0) {
                    if (have == needed) have = 0;             // running status
                    buf[1 + have] = b; have++;
                    if (have == needed) { buf[0] = status; emit(buf, 1 + needed); }
                }
            }
        }

        private int dataBytes(int s) {
            switch (s & 0xF0) {
                case 0xC0: case 0xD0: return 1;
                case 0xF0:
                    if (s == 0xF1 || s == 0xF3) return 1;
                    if (s == 0xF2) return 2;
                    return 0;
                default: return 2;
            }
        }

        private void emit(int[] b, int n) {
            JSONArray arr = new JSONArray();
            for (int i = 0; i < n; i++) arr.put(b[i]);
            JSObject data = new JSObject();
            data.put("id", id);
            data.put("data", arr);
            notifyListeners("midiMessage", data);
        }
    }

    // ── Bluetooth: scan for MIDI keyboards and connect one ─────────────────────
    private PluginCall pairingCall;

    @PluginMethod
    public void showBluetoothPairing(PluginCall call) {
        if (midi == null) { call.reject(getContext().getString(R.string.midi_unavailable)); return; }
        String alias = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetooth" : "location";
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "pairingPermission");
            return;
        }
        startPairing(call);
    }

    @PermissionCallback
    private void pairingPermission(PluginCall call) {
        String alias = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetooth" : "location";
        if (getPermissionState(alias) == PermissionState.GRANTED) startPairing(call);
        else call.reject(getContext().getString(R.string.bt_permission));
    }

    @SuppressWarnings("MissingPermission")
    private void startPairing(PluginCall call) {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = bm == null ? null : bm.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            main.post(() -> new AlertDialog.Builder(getActivity())
                .setTitle(R.string.bt_title)
                .setMessage(R.string.bt_off)
                .setPositiveButton(android.R.string.ok, null)
                .show());
            call.resolve();
            return;
        }
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) { call.resolve(); return; }
        pairingCall = call;

        List<BluetoothDevice> found = new ArrayList<>();
        main.post(() -> {
            ArrayAdapter<String> list = new ArrayAdapter<>(getActivity(), android.R.layout.select_dialog_item);
            final AlertDialog[] dialog = new AlertDialog[1];
            ScanCallback cb = new ScanCallback() {
                @Override public void onScanResult(int type, ScanResult r) {
                    BluetoothDevice d = r.getDevice();
                    for (BluetoothDevice f : found) if (f.getAddress().equals(d.getAddress())) return;
                    found.add(d);
                    String n = d.getName();
                    if (n == null && r.getScanRecord() != null) n = r.getScanRecord().getDeviceName();
                    list.add(n != null ? n : d.getAddress());
                    list.notifyDataSetChanged();
                }
            };
            Runnable stop = () -> { try { scanner.stopScan(cb); } catch (Exception ignored) {} };
            dialog[0] = new AlertDialog.Builder(getActivity())
                .setTitle(R.string.bt_searching)
                .setAdapter(list, (dlg, which) -> {
                    stop.run();
                    connect(found.get(which));
                })
                .setNegativeButton(android.R.string.cancel, (dlg, w) -> stop.run())
                .setOnDismissListener(dlg -> { stop.run(); finishPairing(); })
                .create();
            dialog[0].show();
            List<ScanFilter> filters = Collections.singletonList(
                new ScanFilter.Builder().setServiceUuid(new ParcelUuid(MIDI_SERVICE)).build());
            ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
            try { scanner.startScan(filters, settings, cb); } catch (Exception e) { dialog[0].setTitle(e.getMessage()); }
            main.postDelayed(() -> {
                stop.run();
                if (dialog[0].isShowing()) dialog[0].setTitle(getContext().getString(found.isEmpty() ? R.string.bt_none : R.string.bt_choose));
            }, SCAN_MS);
        });
    }

    private void connect(BluetoothDevice device) {
        midi.openBluetoothDevice(device, opened -> {
            if (opened == null) return;
            bluetooth.add(opened);
            addDevice(opened);
        }, main);
    }

    private void finishPairing() {
        changed();
        if (pairingCall != null) { pairingCall.resolve(); pairingCall = null; }
    }
}
