package com.hoaidroid.pianooo;

import android.content.Intent;
import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PianoooMidiPlugin.class);
        registerPlugin(PianoooFilesPlugin.class);
        super.onCreate(savedInstanceState);
        // Full screen: the falling notes and the keyboard get every pixel
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        hideSystemBars();
        // A file that opened the app (Files, browser downloads, "Share › Pianooo")
        if (savedInstanceState == null) PianoooFilesPlugin.handleIntent(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        PianoooFilesPlugin.handleIntent(this, intent);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
