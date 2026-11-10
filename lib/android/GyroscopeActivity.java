package app.dshgo.shell;

import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public final class GyroscopeActivity extends MainActivity implements SensorEventListener {
    private static final String SAMPLE_URL = PAGE_ORIGIN + "/gyroscope.json";
    private static final String INACTIVE = "{\"status\":\"inactive\"}";

    // The listener runs on the main thread. WebView reads an immutable snapshot on its worker.
    private volatile String snapshot = INACTIVE;
    private SensorManager activeManager;

    @Override
    protected void onResume() {
        super.onResume();
        SensorManager manager = getSystemService(SensorManager.class);
        Sensor sensor = manager == null ? null : manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
        if (sensor == null) {
            snapshot = "{\"status\":\"unavailable\"}";
            return;
        }
        snapshot = "{\"status\":\"waiting\"}";
        if (manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)) {
            activeManager = manager;
        } else {
            snapshot = "{\"status\":\"error\"}";
        }
    }

    @Override
    protected void onPause() {
        if (activeManager != null) {
            activeManager.unregisterListener(this);
            activeManager = null;
        }
        snapshot = INACTIVE;
        super.onPause();
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (activeManager == null) return;
        float x = event.values[0];
        float y = event.values[1];
        float z = event.values[2];
        if (!Float.isFinite(x) || !Float.isFinite(y) || !Float.isFinite(z)) return;
        snapshot = "{\"status\":\"active\",\"x\":" + x + ",\"y\":" + y + ",\"z\":" + z
            + ",\"timestampNanos\":\"" + event.timestamp + "\"}";
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }

    @Override
    String pagePolicy() {
        return super.pagePolicy() + "; connect-src " + SAMPLE_URL;
    }

    @Override
    WebResourceResponse localResource(WebResourceRequest request) {
        if (!"GET".equals(request.getMethod()) || !SAMPLE_URL.equals(request.getUrl().toString())) return null;
        return new WebResourceResponse("application/json", "UTF-8", 200, "OK",
            Collections.singletonMap("Cache-Control", "no-store"),
            new ByteArrayInputStream(snapshot.getBytes(StandardCharsets.UTF_8)));
    }
}
