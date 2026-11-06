package com.hoaidroid.pianooo;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Files for the Android app — the counterpart of PianoooFilesPlugin.swift:
 *  - importFiles: the system file picker, several files at once (a song's MIDI
 *    and its sheet-music PDF together), copied into the library
 *  - files opened or shared from other apps (MainActivity passes the intent)
 *  - printFile: prints a sheet-music PDF on A4 with Android's print dialog
 * The library is the app's own folder (getExternalFilesDir), which the web
 * app reaches as /Documents (src/platform/ipad/vfs.ts).
 */
@CapacitorPlugin(name = "PianoooFiles")
public class PianoooFilesPlugin extends Plugin {

    static final Set<String> SUPPORTED = new HashSet<>(Arrays.asList(
        "mid", "midi", "kar", "musicxml", "xml", "mxl", "gp", "gp3", "gp4", "gp5", "gpx", "cap"));

    /** Library paths (e.g. "/Documents/Song.mid") not yet picked up by the web app */
    static final List<String> pending = new ArrayList<>();
    private static WeakReference<PianoooFilesPlugin> instance = new WeakReference<>(null);

    @Override
    public void load() { instance = new WeakReference<>(this); }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSArray paths = new JSArray();
        synchronized (pending) {
            for (String p : pending) paths.put(p);
            pending.clear();
        }
        JSObject ret = new JSObject();
        ret.put("paths", paths);
        call.resolve(ret);
    }

    // ── Import from inside the app ──────────────────────────────────────────
    @PluginMethod
    public void importFiles(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        List<Uri> uris = new ArrayList<>();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
            else if (data.getData() != null) uris.add(data.getData());
        }
        JSArray paths = new JSArray();
        for (String p : importAll(getContext(), uris)) paths.put(p);
        JSObject ret = new JSObject();
        ret.put("paths", paths);
        call.resolve(ret);
    }

    /** Music files first, so a song keeps its name and its PDF follows it */
    static List<String> importAll(Context ctx, List<Uri> uris) {
        List<String[]> items = new ArrayList<>();   // { uri, name }
        for (Uri u : uris) items.add(new String[] { u.toString(), displayName(ctx, u) });
        items.sort((a, b) -> {
            boolean pa = ext(a[1]).equals("pdf"), pb = ext(b[1]).equals("pdf");
            return pa == pb ? a[1].compareToIgnoreCase(b[1]) : (pa ? 1 : -1);
        });
        Map<String, String> renamed = new HashMap<>();   // song stem → stem it got in the library
        List<String> paths = new ArrayList<>();
        for (String[] it : items) {
            String name = it[1], e = ext(name);
            if (!e.equals("pdf") && !SUPPORTED.contains(e)) continue;
            String stem = stem(name);
            String wanted = e.equals("pdf") && renamed.containsKey(stem) ? renamed.get(stem) + ".pdf" : name;
            String path = importIntoLibrary(ctx, Uri.parse(it[0]), wanted);
            if (path == null) continue;
            paths.add(path);
            if (!e.equals("pdf")) renamed.put(stem, stem(path.substring(path.lastIndexOf('/') + 1)));
        }
        return paths;
    }

    // ── Files opened or shared from other apps ──────────────────────────────
    static void handleIntent(Context ctx, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) uris.add(intent.getData());
        else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        if (uris.isEmpty()) return;
        List<String> paths = importAll(ctx, uris);
        String song = null;
        for (String p : paths) if (!ext(p).equals("pdf")) { song = p; break; }
        PianoooFilesPlugin plugin = instance.get();
        if (song != null) {
            synchronized (pending) { pending.add(song); }
            if (plugin != null) {
                JSObject d = new JSObject();
                d.put("path", song);
                plugin.notifyListeners("fileOpened", d, true);
            }
        } else if (!paths.isEmpty() && plugin != null) {
            JSObject d = new JSObject();
            d.put("path", paths.get(0));
            plugin.notifyListeners("libraryChanged", d);
        }
    }

    // ── Copy into the library ───────────────────────────────────────────────
    static File libraryDir(Context ctx) {
        File dir = ctx.getExternalFilesDir(null);
        return dir != null ? dir : ctx.getFilesDir();
    }

    /** Returns the library path ("/Documents/Song.mid"), reusing an identical copy */
    static String importIntoLibrary(Context ctx, Uri uri, String name) {
        File lib = libraryDir(ctx);
        String safe = name.replace('/', '_').replace('\\', '_');
        String stem = stem(safe), e = ext(safe);
        byte[] bytes;
        try (InputStream in = ctx.getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            bytes = readAll(in);
        } catch (IOException | SecurityException ex) {
            return null;
        }
        File dest = new File(lib, safe);
        for (int n = 2; dest.exists(); n++) {
            if (sameContent(dest, bytes)) return "/Documents/" + dest.getName();
            dest = new File(lib, stem + " (" + n + ")" + (e.isEmpty() ? "" : "." + e));
        }
        try (OutputStream out = new FileOutputStream(dest)) {
            out.write(bytes);
        } catch (IOException ex) {
            return null;
        }
        return "/Documents/" + dest.getName();
    }

    private static boolean sameContent(File f, byte[] bytes) {
        if (f.length() != bytes.length) return false;
        try (InputStream in = new FileInputStream(f)) {
            return Arrays.equals(readAll(in), bytes);
        } catch (IOException ex) {
            return false;
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        for (int r; (r = in.read(buf)) > 0; ) out.write(buf, 0, r);
        return out.toByteArray();
    }

    static String displayName(Context ctx, Uri uri) {
        String name = null;
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            try (Cursor c = ctx.getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception ignored) {}
        }
        if (name == null) name = uri.getLastPathSegment();
        return name != null ? name : "Song.mid";
    }

    static String ext(String name) {
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    static String stem(String name) {
        int dot = name.lastIndexOf('.');
        return dot < 0 ? name : name.substring(0, dot);
    }

    // ── Printing (sheet music on A4) ────────────────────────────────────────
    @PluginMethod
    public void printFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null || !path.startsWith("/Documents/")) { call.reject("path must be inside the library"); return; }
        File file = new File(libraryDir(getContext()), path.substring("/Documents/".length()));
        if (!file.exists()) { call.reject("File not found"); return; }
        getActivity().runOnUiThread(() -> {
            PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            String job = stem(file.getName());
            PrintAttributes attrs = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                .build();
            pm.print(job, new PdfAdapter(file, job), attrs);
            JSObject ret = new JSObject();
            ret.put("printed", true);
            call.resolve(ret);
        });
    }

    private static class PdfAdapter extends PrintDocumentAdapter {
        private final File file;
        private final String name;
        PdfAdapter(File file, String name) { this.file = file; this.name = name; }

        @Override
        public void onLayout(PrintAttributes oldA, PrintAttributes newA, CancellationSignal cancel, LayoutResultCallback cb, Bundle extras) {
            if (cancel.isCanceled()) { cb.onLayoutCancelled(); return; }
            cb.onLayoutFinished(new PrintDocumentInfo.Builder(name + ".pdf")
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true);
        }

        @Override
        public void onWrite(PageRange[] pages, ParcelFileDescriptor dest, CancellationSignal cancel, WriteResultCallback cb) {
            try (InputStream in = new FileInputStream(file); OutputStream out = new FileOutputStream(dest.getFileDescriptor())) {
                byte[] buf = new byte[65536];
                for (int r; (r = in.read(buf)) > 0; ) out.write(buf, 0, r);
                cb.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
            } catch (IOException e) {
                cb.onWriteFailed(e.getMessage());
            }
        }
    }
}
