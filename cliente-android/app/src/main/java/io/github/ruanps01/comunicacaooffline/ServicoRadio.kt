package io.github.ruanps01.comunicacaooffline

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Serviço em primeiro plano do "modo rádio ligado": mantém o processo e os
 * rádios (BLE, Wi-Fi P2P, servidor local) vivos com o app minimizado, com
 * uma notificação fixa avisando que o aparelho está escutando.
 */
class ServicoRadio : Service() {
    companion object {
        const val CANAL = "radio-ligado"
        const val ID = 4242
        const val EXTRA_TITULO = "titulo"
        const val EXTRA_TEXTO = "texto"
    }

    private var trava: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val titulo = intent?.getStringExtra(EXTRA_TITULO) ?: "Rádio ligado"
        val texto = intent?.getStringExtra(EXTRA_TEXTO) ?: "Escutando e repassando mensagens por perto."
        criarCanal()
        val abrir = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notificacao: Notification = NotificationCompat.Builder(this, CANAL)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setContentIntent(abrir)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        val tipo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
        ServiceCompat.startForeground(this, ID, notificacao, tipo)
        if (trava == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            trava = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "comunicacaooffline:radio").apply { acquire(12 * 60 * 60 * 1000L) }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        trava?.let { if (it.isHeld) it.release() }
        trava = null
        super.onDestroy()
    }

    private fun criarCanal() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CANAL) == null) {
            nm.createNotificationChannel(NotificationChannel(CANAL, "Rádio ligado", NotificationManager.IMPORTANCE_LOW))
        }
    }
}
