package com.simplemarkdown.reader;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 10;
    private static final int OPEN_MARKDOWN_REQUEST = 11;
    private static final int SAVE_MARKDOWN_REQUEST = 12;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private String pendingSaveContent;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        webView = new WebView(this);
        webView.setFitsSystemWindows(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }

                MainActivity.this.filePathCallback = filePathCallback;

                try {
                    startActivityForResult(fileChooserParams.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException error) {
                    MainActivity.this.filePathCallback = null;
                    showToast("无法打开文件选择器");
                    return false;
                }

                return true;
            }
        });
        webView.addJavascriptInterface(new NativeMarkdownBridge(), "NativeMarkdown");
        setContentView(webView);

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(result);
                filePathCallback = null;
            }
            return;
        }

        if (requestCode == OPEN_MARKDOWN_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                importMarkdown(data.getData());
            }
            return;
        }

        if (requestCode == SAVE_MARKDOWN_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                exportMarkdown(data.getData());
            } else {
                notifySaveResult(false, "已取消导出");
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    private void importMarkdown(Uri uri) {
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) {
                throw new IllegalStateException("empty input");
            }

            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int length;
            while ((length = input.read(buffer)) != -1) {
                output.write(buffer, 0, length);
            }

            String content = output.toString("UTF-8");
            String name = uri.getLastPathSegment();
            String script = "window.receiveNativeMarkdown("
                    + JSONObject.quote(name == null ? "文档" : name)
                    + ","
                    + JSONObject.quote(content)
                    + ")";
            webView.evaluateJavascript(script, null);
        } catch (Exception error) {
            showToast("导入失败");
        }
    }

    private void exportMarkdown(Uri uri) {
        try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) {
                throw new IllegalStateException("empty output");
            }

            output.write((pendingSaveContent == null ? "" : pendingSaveContent).getBytes(StandardCharsets.UTF_8));
            output.flush();
            notifySaveResult(true, "已导出");
        } catch (Exception error) {
            notifySaveResult(false, "导出失败");
        } finally {
            pendingSaveContent = null;
        }
    }

    private void notifySaveResult(boolean success, String message) {
        if (webView == null) {
            return;
        }

        String script = "window.receiveNativeSaveResult("
                + (success ? "true" : "false")
                + ","
                + JSONObject.quote(message)
                + ")";
        webView.evaluateJavascript(script, null);
    }

    private void showToast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private class NativeMarkdownBridge {
        @JavascriptInterface
        public void openMarkdown() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("text/*");
                try {
                    startActivityForResult(intent, OPEN_MARKDOWN_REQUEST);
                } catch (ActivityNotFoundException error) {
                    showToast("无法打开文件选择器");
                }
            });
        }

        @JavascriptInterface
        public void saveMarkdown(String fileName, String content) {
            pendingSaveContent = content;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("text/markdown");
                intent.putExtra(Intent.EXTRA_TITLE, fileName == null || fileName.isEmpty() ? "markdown-note.md" : fileName);
                try {
                    startActivityForResult(intent, SAVE_MARKDOWN_REQUEST);
                } catch (ActivityNotFoundException error) {
                    notifySaveResult(false, "无法打开保存位置");
                }
            });
        }
    }
}
