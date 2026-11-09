package io.github.ruanps01.canal.morse

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Lanterna para o Morse por luz. setTorchMode não precisa de permissão de
 * câmera e responde rápido o bastante para pontos de 120 ms.
 */
@CapacitorPlugin(name = "Lanterna")
class LanternaPlugin : Plugin() {
    private val cameras: CameraManager by lazy { context.getSystemService(Context.CAMERA_SERVICE) as CameraManager }

    private val idCamera: String? by lazy {
        runCatching {
            cameras.cameraIdList.firstOrNull { id ->
                val c = cameras.getCameraCharacteristics(id)
                c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true &&
                    c.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
            }
        }.getOrNull()
    }

    @PluginMethod
    fun disponivel(call: PluginCall) {
        call.resolve(JSObject().put("disponivel", idCamera != null))
    }

    @PluginMethod
    fun ligar(call: PluginCall) = aplicar(call, true)

    @PluginMethod
    fun desligar(call: PluginCall) = aplicar(call, false)

    private fun aplicar(call: PluginCall, ligado: Boolean) {
        val id = idCamera ?: return call.reject("aparelho sem lanterna")
        try {
            cameras.setTorchMode(id, ligado)
            call.resolve()
        } catch (e: Exception) {
            call.reject("lanterna ocupada: ${e.message}")
        }
    }
}
