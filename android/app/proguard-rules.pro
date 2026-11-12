# React Native / Hermes / Expo — keep what the bridge needs; allow R8 to obfuscate the rest.
# Google Play expects obfuscation ≥ 25% (enforcement Feb 2027).

-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep,allowobfuscation @interface com.facebook.common.internal.DoNotStrip

-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
}
-keepclassmembers @com.facebook.proguard.annotations.KeepGettersAndSetters class * {
  void set*(***);
  *** get*();
}

-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Reanimated / Worklets / Screens
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.common.** { *; }
-keep class com.swmansion.rnscreens.** { *; }

# RefreshControl + react-native-screens: Screen.kt matches CircleImageView by simpleName.
# If R8 renames it, getChildDrawingOrder crashes (Sentry REACT-NATIVE-N).
-keepnames class androidx.swiperefreshlayout.widget.CircleImageView
-keepnames class androidx.swiperefreshlayout.widget.**

# Expo modules (updates, notifications, camera, secure-store, etc.)
-keep class expo.modules.** { *; }
-keep class expo.modules.updates.** { *; }
-keep class expo.modules.notifications.** { *; }
-keepclassmembers class * {
  @expo.modules.core.interfaces.ExpoProp *;
}

# AsyncStorage / MMKV-style bridges
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# Sentry (native + RN)
-keepattributes SourceFile,LineNumberTable
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**

# OkHttp / Retrofit noise from transitive deps
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn com.google.android.gms.**

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep Parcelable / Serializable helpers used across RN modules
-keepclassmembers class * implements android.os.Parcelable {
  public static final ** CREATOR;
}
