package app.dshgo.shell;

import android.app.Activity;
import android.content.res.AssetManager;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String PAGE = "https://appassets.androidplatform.net/index.html";
    private static final String PAGE_POLICY =
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
        + "img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    private WebView webView;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new AppPageClient(getAssets()));
        setContentView(webView);
        webView.loadUrl(PAGE);
    }

    private static final class AppPageClient extends WebViewClient {
        private final AssetManager assets;

        AppPageClient(AssetManager assets) {
            this.assets = assets;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request.isForMainFrame() && PAGE.equals(request.getUrl().toString())) {
                try {
                    return new WebResourceResponse("text/html", "UTF-8", 200, "OK",
                        Collections.singletonMap("Content-Security-Policy", PAGE_POLICY),
                        assets.open("index.html"));
                } catch (IOException unavailable) {
                    return emptyResponse(404, "Not Found");
                }
            }
            return emptyResponse(403, "Forbidden");
        }
    }

    private static WebResourceResponse emptyResponse(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
