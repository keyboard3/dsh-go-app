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

public class MainActivity extends Activity {
    static final String PAGE_ORIGIN = "https://appassets.androidplatform.net";
    private static final String PAGE = PAGE_ORIGIN + "/index.html";
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
        webView.setWebViewClient(new AppPageClient(this));
        setContentView(webView);
        webView.loadUrl(PAGE);
    }

    String pagePolicy() {
        return PAGE_POLICY;
    }

    WebResourceResponse localResource(WebResourceRequest request) {
        return null;
    }

    private static final class AppPageClient extends WebViewClient {
        private final MainActivity activity;
        private final AssetManager assets;

        AppPageClient(MainActivity activity) {
            this.activity = activity;
            this.assets = activity.getAssets();
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
                        Collections.singletonMap("Content-Security-Policy", activity.pagePolicy()),
                        assets.open("index.html"));
                } catch (IOException unavailable) {
                    return emptyResponse(404, "Not Found");
                }
            }
            if (!request.isForMainFrame()) {
                WebResourceResponse resource = activity.localResource(request);
                if (resource != null) return resource;
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
