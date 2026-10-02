package com.mgm.rnhermeshost;

import android.os.Bundle;
import com.facebook.react.ReactActivity;
import com.facebook.react.ReactActivityDelegate;

public class MainActivity extends ReactActivity {
  @Override
  protected String getMainComponentName() {
    return "MgmRnHermesHost";
  }

  @Override
  protected ReactActivityDelegate createReactActivityDelegate() {
    return new ReactActivityDelegate(this, getMainComponentName()) {
      @Override
      protected Bundle getLaunchOptions() {
        Bundle options = new Bundle();
        options.putBoolean("rejectionProbe", getIntent().getBooleanExtra("mgmRejectionProbe", false));
        return options;
      }
    };
  }
}
