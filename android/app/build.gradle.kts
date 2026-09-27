import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appVersion = Properties().apply {
    rootProject.file("version.properties").inputStream().use { load(it) }
}
val releaseVersionName = requireNotNull(appVersion.getProperty("versionName"))
require(releaseVersionName.matches(Regex("[0-9]+\\.[0-9]+\\.[0-9]+"))) {
    "version.properties must contain a numeric versionName (major.minor.patch)"
}
val releaseVersionCode = requireNotNull(appVersion.getProperty("versionCode")?.toIntOrNull())
require(releaseVersionCode in 1..2100000000) {
    "version.properties must contain a positive Android versionCode"
}

android {
    namespace = "app.yuxino.mimi.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.yuxino.mimi.android"
        minSdk = 29
        targetSdk = 35
        versionCode = releaseVersionCode
        versionName = releaseVersionName
        testInstrumentationRunner = "app.yuxino.mimi.android.UiSmokeInstrumentation"
    }

    buildTypes {
        release {
            isDebuggable = false
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
