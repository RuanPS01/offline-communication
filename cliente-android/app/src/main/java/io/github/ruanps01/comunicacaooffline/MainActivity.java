package io.github.ruanps01.comunicacaooffline;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins do próprio app (os dos canais são registrados pelo Capacitor).
        registerPlugin(SistemaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
