#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = 'build-workspace';
const BUILD_DATA = 'build-data';

const ANDROID_PERMISSIONS = {
  INTERNET: 'android.permission.INTERNET',
  ACCESS_NETWORK_STATE: 'android.permission.ACCESS_NETWORK_STATE',
  CAMERA: 'android.permission.CAMERA',
  RECORD_AUDIO: 'android.permission.RECORD_AUDIO',
  MODIFY_AUDIO_SETTINGS: 'android.permission.MODIFY_AUDIO_SETTINGS',
  READ_EXTERNAL_STORAGE: 'android.permission.READ_EXTERNAL_STORAGE',
  READ_MEDIA_IMAGES: 'android.permission.READ_MEDIA_IMAGES',
  READ_MEDIA_VIDEO: 'android.permission.READ_MEDIA_VIDEO',
  ACCESS_COARSE_LOCATION: 'android.permission.ACCESS_COARSE_LOCATION',
  ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
  READ_CONTACTS: 'android.permission.READ_CONTACTS',
  READ_PHONE_STATE: 'android.permission.READ_PHONE_STATE',
  POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS',
  VIBRATE: 'android.permission.VIBRATE',
  BLUETOOTH: 'android.permission.BLUETOOTH'
};

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function write(p, content) { ensureDir(path.dirname(p)); fs.writeFileSync(p, content); }
function escapeXml(s) {
  return String(s || '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}
function gradleEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function pkgToPath(pkg) { return pkg.replace(/\./g, '/'); }
function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) { ensureDir(d); copyRecursive(s, d); }
    else fs.copyFileSync(s, d);
  }
}
function writeDefaultIcon(dest) {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1KsAAAAASUVORK5CYII=';
  fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
}

function main() {
  console.log('Reading config …');
  const cfg = JSON.parse(fs.readFileSync(path.join(BUILD_DATA, 'config.json'), 'utf8'));
  const c = cfg.config || {};
  const pkg = cfg.packageName;
  const appName = cfg.projectName || 'App';
  const buildType = cfg.buildType;
  const variant = cfg.variant;
  const isRelease = (variant === 'release' || buildType === 'AAB');

  // Release build requires signing
  if (isRelease && !(cfg.signing && cfg.signing.keystore)) {
    throw new Error('Release/AAB builds require a signing keystore. Generate one in the app: Settings → Signing Key → Generate.');
  }

  const minSdk = c.minSdk || 24;
  const targetSdk = c.targetSdk || 34;

  let outputPath, gradleTask;
  if (buildType === 'AAB') {
    gradleTask = 'bundleRelease';
    outputPath = 'app/build/outputs/bundle/release/app-release.aab';
  } else if (variant === 'release') {
    gradleTask = 'assembleRelease';
    outputPath = 'app/build/outputs/apk/release/app-release.apk';
  } else {
    gradleTask = 'assembleDebug';
    outputPath = 'app/build/outputs/apk/debug/app-debug.apk';
  }

  console.log('Preparing Android project …', { pkg, appName, buildType, variant });

  if (fs.existsSync(ROOT)) fs.rmSync(ROOT, { recursive: true, force: true });
  ensureDir(ROOT);
  const pkgPath = pkgToPath(pkg);
  const srcDir = path.join(ROOT, 'app/src/main/java', pkgPath);
  ensureDir(srcDir);

  // ─── Root files ───
  write(path.join(ROOT, 'settings.gradle'), `pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories { google(); mavenCentral() }
}
rootProject.name = 'DebugBuilderApp'
include ':app'`);

  write(path.join(ROOT, 'gradle.properties'), `android.useAndroidX=true
android.enableJetifier=true
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
org.gradle.parallel=true
org.gradle.caching=true`);

  write(path.join(ROOT, 'build.gradle'), `plugins {
    id 'com.android.application' version '8.5.2' apply false
    id 'org.jetbrains.kotlin.android' version '1.9.24' apply false
}
allprojects {
    repositories { google(); mavenCentral() }
}`);

  // ─── Signing (release only) ───
  let keystorePath = null;
  if (isRelease) {
    const signing = cfg.signing;
    const b64 = (signing.keystore || '').split(',').pop();
    const buf = Buffer.from(b64, 'base64');
    keystorePath = path.join(ROOT, 'app', 'release.p12');
    ensureDir(path.dirname(keystorePath));
    fs.writeFileSync(keystorePath, buf);

    write(path.join(ROOT, 'signing.properties'), `storePassword=${signing.storePassword || ''}
keyAlias=${signing.alias || 'debugbuilder'}
keyPassword=${signing.keyPassword || signing.storePassword || ''}`);

    console.log('Keystore installed (PKCS#12)');
  }

  // ─── app/build.gradle ───
  write(path.join(ROOT, 'app/build.gradle'), `plugins {
    id 'com.android.application'
    id 'org.jetbrains.kotlin.android'
}

def signingProps = new Properties()
def signingFile = rootProject.file('signing.properties')
if (signingFile.exists()) {
    signingProps.load(new FileInputStream(signingFile))
}

android {
    namespace '${gradleEscape(pkg)}'
    compileSdk 34

    defaultConfig {
        applicationId '${gradleEscape(pkg)}'
        minSdk ${minSdk}
        targetSdk ${targetSdk}
        versionCode ${cfg.versionCode}
        versionName '${gradleEscape(cfg.versionName)}'
    }

    ${isRelease ? `
    signingConfigs {
        release {
            storeFile file('release.p12')
            storeType 'PKCS12'
            storePassword signingProps['storePassword']
            keyAlias signingProps['keyAlias']
            keyPassword signingProps['keyPassword']
        }
    }
    ` : ''}

    buildTypes {
        debug { minifyEnabled false }
        release {
            minifyEnabled false
            shrinkResources false
            ${isRelease ? 'signingConfig signingConfigs.release' : ''}
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = '17' }
}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.7.0'
    implementation 'androidx.core:core-ktx:1.13.1'
    implementation 'androidx.constraintlayout:constraintlayout:2.1.4'
    implementation 'com.google.android.material:material:1.12.0'
    implementation 'androidx.webkit:webkit:1.11.0'
    implementation 'androidx.swiperefreshlayout:swiperefreshlayout:1.1.0'
}`);

  // ─── AndroidManifest.xml ───
  const permsBlock = (cfg.permissions || []).map(p => {
    const full = ANDROID_PERMISSIONS[p];
    return full ? `    <uses-permission android:name="${full}" />` : null;
  }).filter(Boolean).join('\n');
  const cleartext = c.cleartext ? 'android:usesCleartextTraffic="true"' : '';
  const orientation = c.orientation === 'landscape' ? 'landscape' : c.orientation === 'auto' ? 'fullSensor' : 'portrait';
  const themeName = c.fullscreen ? '@style/Theme.Fullscreen' : '@style/Theme.DebugBuilder';
  const splashTheme = c.splash ? '@style/Theme.Splash' : themeName;

  write(path.join(ROOT, 'app/src/main/AndroidManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

${permsBlock}

    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:theme="${themeName}"
        android:allowBackup="true"
        android:supportsRtl="true"
        ${cleartext}>

        ${c.splash ? `
        <activity android:name=".SplashActivity"
            android:theme="${splashTheme}"
            android:exported="true"
            android:screenOrientation="${orientation}">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        ` : `
        <activity android:name=".MainActivity"
            android:theme="${themeName}"
            android:exported="true"
            android:screenOrientation="${orientation}"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        `}

        ${c.splash ? `
        <activity android:name=".MainActivity"
            android:theme="${themeName}"
            android:screenOrientation="${orientation}"
            android:configChanges="orientation|screenSize|keyboardHidden" />
        ` : ''}

    </application>
</manifest>`);

  // ─── MainActivity.kt ───
  const jsEnabled = c.js !== false;
  const domStorage = c.domStorage !== false;
  const zoomEnabled = c.zoom === true;
  const keepAwake = c.keepAwake === true;
  const pullToRefresh = c.pullToRefresh === true;
  const downloadSupport = c.downloads === true;
  const fileUpload = c.fileUpload !== false;
  const geolocation = c.geolocation === true;
  const cameraAccess = c.cameraAccess === true;
  const micAccess = c.micAccess === true;
  const externalLinks = c.externalLinks || 'browser';
  const entryFile = (c.entry || 'index.html').replace(/^\/+/, '');

  write(path.join(srcDir, 'MainActivity.kt'), `package ${pkg}

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import android.widget.FrameLayout

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var swipeRefresh: SwipeRefreshLayout? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        ${keepAwake ? 'window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)' : ''}

        val container = FrameLayout(this)
        webView = WebView(this)
        container.addView(webView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))

        ${pullToRefresh ? `
        swipeRefresh = SwipeRefreshLayout(this)
        swipeRefresh!!.addView(container)
        swipeRefresh!!.setOnRefreshListener { webView.reload() }
        setContentView(swipeRefresh)
        ` : 'setContentView(container)'}

        webView.settings.apply {
            javaScriptEnabled = ${jsEnabled}
            domStorageEnabled = ${domStorage}
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            setSupportZoom(${zoomEnabled})
            builtInZoomControls = ${zoomEnabled}
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            ${geolocation ? 'geolocationEnabled = true' : ''}
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                ${externalLinks === 'browser' ? `
                if ((url.startsWith("http://") || url.startsWith("https://")) && !url.startsWith("file://")) {
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        true
                    } catch (e: Exception) { false }
                }
                ` : ''}
                return false
            }
        }

        ${downloadSupport ? `
        webView.setDownloadListener { url, _, _, _, _ ->
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) {}
        }
        ` : ''}

        webView.webChromeClient = object : WebChromeClient() {
            ${cameraAccess || micAccess ? `
            override fun onPermissionRequest(request: PermissionRequest?) {
                runOnUiThread { request?.grant(request.resources) }
            }
            ` : ''}
        }

        ${c.offline ? 'webView.settings.cacheMode = WebSettings.LOAD_CACHE_ELSE_NETWORK' : ''}

        webView.loadUrl("file:///android_asset/${entryFile}")
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}`);

  // ─── SplashActivity.kt (optional) ───
  if (c.splash) {
    write(path.join(srcDir, 'SplashActivity.kt'), `package ${pkg}

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity

class SplashActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)
        Handler(Looper.getMainLooper()).postDelayed({
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }, 1200L)
    }
}`);

    write(path.join(ROOT, 'app/src/main/res/layout/activity_splash.xml'), `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="${escapeXml(c.splashBg || '#0a0e0d')}">
    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_gravity="center"
        android:text="${escapeXml(c.splashText || appName)}"
        android:textColor="#ffffff"
        android:textSize="24sp"
        android:textStyle="bold" />
</FrameLayout>`);
  }

  // ─── Resources ───
  write(path.join(ROOT, 'app/src/main/res/values/strings.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${escapeXml(appName)}</string>
</resources>`);

  write(path.join(ROOT, 'app/src/main/res/values/styles.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.DebugBuilder" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <item name="android:statusBarColor">@android:color/transparent</item>
    </style>
    <style name="Theme.Fullscreen" parent="Theme.DebugBuilder">
        <item name="android:windowFullscreen">true</item>
    </style>
    <style name="Theme.Splash" parent="Theme.DebugBuilder">
        <item name="android:windowBackground">${escapeXml(c.splashBg || '#0a0e0d')}</item>
    </style>
</resources>`);

  // ─── Icons ───
  const sizes = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 };
  let iconSrc = null;
  if (cfg.icon && cfg.icon.startsWith('data:image')) {
    try {
      const buf = Buffer.from(cfg.icon.split(',')[1], 'base64');
      iconSrc = path.join(BUILD_DATA, 'icon-src.png');
      fs.writeFileSync(iconSrc, buf);
    } catch { /* fallback below */ }
  }
  for (const [dir, size] of Object.entries(sizes)) {
    const destDir = path.join(ROOT, 'app/src/main/res', dir);
    ensureDir(destDir);
    const dest = path.join(destDir, 'ic_launcher.png');
    if (iconSrc) {
      try { execSync(`convert "${iconSrc}" -resize ${size}x${size} "${dest}"`, { stdio: 'pipe' }); }
      catch { writeDefaultIcon(dest); }
    } else {
      writeDefaultIcon(dest);
    }
  }

  // ─── Assets: copy project files ───
  const assetsDir = path.join(ROOT, 'app/src/main/assets');
  ensureDir(assetsDir);
  copyRecursive(path.join(BUILD_DATA, 'project'), assetsDir);
  console.log('Copied project into assets/');

  // ─── build-meta.json ───
  write(path.join(ROOT, 'build-meta.json'), JSON.stringify({
    buildType, variant, gradleTask, outputPath,
    keystorePath, packageName: pkg, appName
  }, null, 2));

  console.log('Android project ready ✓');
}

try { main(); }
catch (e) {
  console.error('prepare-android failed:', e.message);
  process.exit(1);
    }
