package com.feltsharpener.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;

/**
 * Felt Sharpener for Android: hosts the (unchanged) web game from assets/www in a full-screen,
 * landscape WebView, and exposes a tiny bridge ("FeltAndroid") so the AI coach can make HTTP
 * requests natively — no browser CORS limits, plain-http LAN servers allowed.
 */
public class MainActivity extends Activity {
    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        // Draw under the camera cutout in landscape (field added in API 28; set reflectively).
        try {
            WindowManager.LayoutParams lp = w.getAttributes();
            WindowManager.LayoutParams.class.getField("layoutInDisplayCutoutMode").setInt(lp, 1 /* SHORT_EDGES */);
            w.setAttributes(lp);
        } catch (Exception ignored) { }

        web = new WebView(this);
        web.setBackgroundColor(0xFF040816);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100); // ignore system font scaling so the table layout stays intact
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.d("FeltSharpener", m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri u = Uri.parse(url);
                if ("file".equals(u.getScheme())) return false;
                // External links open in the browser
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "FeltAndroid");
        setContentView(web);
        hideSystemBars();
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl("file:///android_asset/www/index.html");
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(window.FS && FS.native) ? FS.native.back() : 'exit'", new android.webkit.ValueCallback<String>() {
            @Override public void onReceiveValue(String result) {
                if (result != null && result.contains("exit")) moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onPause() {
        web.evaluateJavascript("window.FS && FS.native && FS.native.onPause()", null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.evaluateJavascript("window.FS && FS.native && FS.native.onResume()", null);
        hideSystemBars();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** Exposed to JavaScript as window.FeltAndroid. */
    private class Bridge {
        @JavascriptInterface
        public void httpRequest(final String id, final String url, final String method, final String headersJson, final String body, final int timeoutMs) {
            new Thread(new Runnable() { @Override public void run() {
                int status = 0;
                String text = "";
                String error = null;
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setRequestMethod(method == null || method.isEmpty() ? "GET" : method);
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(timeoutMs > 0 ? timeoutMs : 180000);
                    JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
                    for (Iterator<String> it = h.keys(); it.hasNext(); ) { String k = it.next(); c.setRequestProperty(k, h.getString(k)); }
                    if (body != null && !body.isEmpty()) {
                        c.setDoOutput(true);
                        byte[] b = body.getBytes("UTF-8");
                        c.setFixedLengthStreamingMode(b.length);
                        OutputStream os = c.getOutputStream();
                        os.write(b);
                        os.close();
                    }
                    status = c.getResponseCode();
                    InputStream is = status >= 400 ? c.getErrorStream() : c.getInputStream();
                    if (is != null) {
                        ByteArrayOutputStream buf = new ByteArrayOutputStream();
                        byte[] chunk = new byte[8192];
                        int n;
                        while ((n = is.read(chunk)) > 0) buf.write(chunk, 0, n);
                        is.close();
                        text = buf.toString("UTF-8");
                    }
                } catch (Exception e) {
                    error = e.getClass().getSimpleName() + (e.getMessage() != null ? ": " + e.getMessage() : "");
                } finally {
                    if (c != null) c.disconnect();
                }
                final String js = "FS.native.done(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(text) + ","
                        + (error == null ? "null" : JSONObject.quote(error)) + ")";
                ui.post(new Runnable() { @Override public void run() { web.evaluateJavascript(js, null); } });
            } }).start();
        }

        @JavascriptInterface
        public String platform() { return "android " + Build.VERSION.RELEASE; }
    }
}
