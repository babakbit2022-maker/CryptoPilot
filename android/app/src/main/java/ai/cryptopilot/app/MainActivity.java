package ai.cryptopilot.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

import java.nio.charset.StandardCharsets;

public class MainActivity extends AppCompatActivity {
    private static final String HOME_URL = "http://87.107.190.74/";
    private static final String SITE_HOST = "87.107.190.74";
    private static final int FILE_CHOOSER_REQUEST = 4101;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);
        configureWebView();
        webView.loadUrl(HOME_URL);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    finish();
                }
            }
        });
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " CryptoPilotAndroid/1.0");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        cookies.flush();

        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectCompactMobileStyles(view);
                CookieManager.getInstance().flush();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;

                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });
    }

    /**
     * App-only responsive styling. This keeps the public website unchanged while
     * making the WebView layout denser and easier to scan on small screens.
     */
    private void injectCompactMobileStyles(WebView view) {
        String css =
                "@media(max-width:700px){" +
                "html{scroll-padding-top:64px;-webkit-text-size-adjust:100%;}" +
                "body{font-size:13px!important;line-height:1.45!important;}" +
                ".topbar{height:auto!important;min-height:56px!important;}" +
                ".topin{min-height:56px!important;height:auto!important;padding:7px 12px!important;gap:9px!important;}" +
                ".brand{min-width:0!important;gap:8px!important;flex:1 1 auto!important;}" +
                ".logo{width:32px!important;height:32px!important;border-radius:10px!important;flex:0 0 32px!important;}" +
                ".brand strong{font-size:14px!important;line-height:1.2!important;}" +
                ".brand span{font-size:8px!important;letter-spacing:.3px!important;}" +
                ".live{padding:6px 8px!important;font-size:10px!important;gap:5px!important;white-space:nowrap!important;}" +
                ".page,main{padding:12px 12px 92px!important;}" +
                ".hero{gap:10px!important;margin-bottom:10px!important;}" +
                ".heroMain,.heroSide{padding:16px!important;border-radius:15px!important;}" +
                ".hero h1,h1{font-size:clamp(24px,7vw,32px)!important;line-height:1.12!important;letter-spacing:-.8px!important;margin:8px 0 10px!important;}" +
                ".hero p{font-size:12px!important;line-height:1.55!important;}" +
                ".eyebrow{font-size:9px!important;letter-spacing:1px!important;}" +
                ".chips{gap:6px!important;margin-top:12px!important;}" +
                ".chip{padding:5px 7px!important;font-size:9px!important;}" +
                ".toolbar{margin:12px 0 8px!important;gap:8px!important;}" +
                ".toolbar h2,.marketToolbar h2{font-size:16px!important;}" +
                ".panel,.growthBanner,.riskPanel,.picksPanel,.whalePanel{padding:13px!important;border-radius:15px!important;}" +
                ".panelHead{gap:6px!important;margin-bottom:10px!important;align-items:flex-start!important;}" +
                ".panelHead h2,.panelHead h2[style]{font-size:14px!important;line-height:1.3!important;}" +
                ".panelHead span{font-size:9px!important;}" +
                ".contentGrid,.dailyRisk{gap:10px!important;margin-top:12px!important;}" +
                ".detail{margin-top:12px!important;}" +
                ".detailGrid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important;}" +
                ".metric,.statusBox,.whaleStat{padding:9px!important;}" +
                ".metric b,.statusBox strong{font-size:13px!important;overflow-wrap:anywhere!important;}" +
                ".cards{gap:7px!important;}" +
                ".coinCard{padding:10px!important;border-radius:12px!important;}" +
                ".price{font-size:15px!important;letter-spacing:-.3px!important;margin:6px 0 2px!important;}" +
                "#coins.cards .coinCard,#marketList.cards .coinCard{gap:7px!important;padding:10px 8px!important;}" +
                "#coins.cards .coinName,#marketList.cards .coinName{font-size:11px!important;}" +
                ".marketHeader,.marketRow{gap:7px!important;padding:10px 8px!important;}" +
                ".marketRow{grid-template-columns:22px minmax(0,1.5fr) minmax(75px,1fr)!important;}" +
                ".marketAsset{gap:6px!important;}" +
                ".marketAsset .assetIcon{width:26px!important;height:26px!important;flex-basis:26px!important;}" +
                ".marketAsset .coinName{font-size:11px!important;}" +
                ".marketPrice{font-size:11px!important;}" +
                ".marketChange{font-size:10px!important;}" +
                ".toolGrid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important;}" +
                ".toolCard{padding:11px!important;border-radius:12px!important;min-width:0!important;}" +
                ".toolIcon{font-size:20px!important;margin-bottom:5px!important;}" +
                ".toolCard h3{font-size:12px!important;line-height:1.35!important;}" +
                ".toolCard p{font-size:10px!important;line-height:1.45!important;}" +
                ".toolCard .toolAction{font-size:10px!important;margin-top:7px!important;}" +
                ".picks{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important;}" +
                ".pick{padding:10px!important;border-radius:12px!important;}" +
                ".pick b{font-size:13px!important;overflow-wrap:anywhere!important;}" +
                ".pick .reason{font-size:9px!important;}" +
                ".growthItems{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important;}" +
                ".growthItem{min-width:0!important;padding:9px!important;gap:6px!important;}" +
                ".whaleSummary,.whaleLeaders{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important;}" +
                ".whaleCard{padding:10px!important;border-radius:12px!important;min-width:0!important;}" +
                ".whaleSymbol{font-size:15px!important;}" +
                ".whaleScore{font-size:24px!important;margin:5px 0!important;}" +
                ".whaleReason{font-size:10px!important;line-height:1.5!important;}" +
                ".search,input,select,textarea{max-width:100%!important;font-size:14px!important;}" +
                "button,.pageBtn{min-height:34px!important;}" +
                ".tableWrap{max-width:100%!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;}" +
                "table{font-size:11px!important;}" +
                "td,th{padding:8px 6px!important;}" +
                ".footer{padding:18px 0 90px!important;}" +
                ".heroMain:hover,.heroSide:hover,.growthBanner:hover,.riskPanel:hover,.picksPanel:hover,.panel:hover,.coinCard:hover,.toolCard:hover,.pick:hover,.metric:hover{transform:none!important;}" +
                ".heroMain,.heroSide,.growthBanner,.riskPanel,.picksPanel,.panel{box-shadow:0 8px 24px rgba(0,0,0,.22)!important;}" +
                "img,canvas,video,iframe{max-width:100%;}" +
                "}" +
                "@media(max-width:380px){" +
                ".toolGrid,.picks,.growthItems,.whaleSummary,.whaleLeaders{grid-template-columns:1fr!important;}" +
                ".heroMain,.heroSide,.panel,.growthBanner,.riskPanel,.picksPanel,.whalePanel{padding:11px!important;}" +
                ".brand span{display:none!important;}" +
                "}";

        String encodedCss = Base64.encodeToString(
                css.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        String script = "(function(){var s=document.getElementById('cp-android-compact-style');" +
                "if(!s){s=document.createElement('style');s.id='cp-android-compact-style';document.head.appendChild(s);}" +
                "s.textContent=atob('" + encodedCss + "');})();";
        view.evaluateJavascript(script, null);
    }

    private boolean handleUrl(Uri uri) {
        if (uri == null) return true;
        if (SITE_HOST.equals(uri.getHost())) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // Ignore external links that have no installed handler.
        }
        return true;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || filePathCallback == null) return;

        Uri[] results = null;
        if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
            results = new Uri[]{data.getData()};
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}