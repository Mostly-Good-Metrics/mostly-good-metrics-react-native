package com.mgm.rnhermeshost;
import android.app.Application;
import com.facebook.react.*;
import com.facebook.react.bridge.JavaScriptExecutorFactory;
import com.facebook.hermes.reactexecutor.HermesExecutorFactory;
import com.facebook.react.shell.MainReactPackage;
import com.reactnativecommunity.asyncstorage.AsyncStoragePackage;
import com.facebook.soloader.SoLoader;
import java.util.*;
public class MainApplication extends Application implements ReactApplication {
 private final ReactNativeHost host = new ReactNativeHost(this) {
  public boolean getUseDeveloperSupport(){return false;}
  protected List<ReactPackage> getPackages(){return Arrays.asList(new MainReactPackage(),new AsyncStoragePackage());}
  protected String getJSMainModuleName(){return "index";}
  protected JavaScriptExecutorFactory getJavaScriptExecutorFactory(){return new HermesExecutorFactory();}
 };
 public ReactNativeHost getReactNativeHost(){return host;}
 public ReactHost getReactHost(){return null;}
 public void onCreate(){super.onCreate();SoLoader.init(this,false);}
}
