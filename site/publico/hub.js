// Página central: detecta o aparelho e mostra o caminho certo.
(function () {
  'use strict';
  var config = window.CONFIG || {};
  var ua = navigator.userAgent;
  var sistema = /android/i.test(ua)
    ? 'android'
    : /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      ? 'ios'
      : 'outro';

  var nomes = { android: 'um Android', ios: 'um iPhone', outro: 'um computador ou outro aparelho' };
  var deteccao = document.getElementById('deteccao');
  var recomendacao = {
    android: 'Recomendado: baixe o APK para ter todos os canais. O app web funciona na hora enquanto isso.',
    ios: 'Recomendado: instale o app web na tela de início. Se o seu iPhone for cadastrado, o app nativo habilita Bluetooth.',
    outro: 'Use o app web. Para a malha Bluetooth, instale o app num celular Android.',
  };
  deteccao.textContent = 'Parece que você está em ' + nomes[sistema] + '. ' + recomendacao[sistema];

  // Mostra só as instruções de instalação do sistema detectado.
  document.querySelectorAll('.instrucoes').forEach(function (el) {
    el.hidden = el.getAttribute('data-sistema') !== sistema;
  });

  // Ordena as opções: a recomendada primeiro.
  var ordem = {
    android: ['opcao-android', 'opcao-web', 'opcao-pwa', 'opcao-ios'],
    ios: ['opcao-pwa', 'opcao-web', 'opcao-ios', 'opcao-android'],
    outro: ['opcao-web', 'opcao-pwa', 'opcao-android', 'opcao-ios'],
  }[sistema];
  var lista = document.querySelector('.opcoes');
  ordem.forEach(function (id, i) {
    var el = document.getElementById(id);
    lista.appendChild(el);
    if (i === 0) el.classList.add('recomendada');
  });

  // APK
  if (!config.apk) {
    var apk = document.getElementById('link-apk');
    apk.classList.add('desabilitado');
    apk.removeAttribute('href');
    apk.setAttribute('aria-disabled', 'true');
    document.getElementById('sem-apk').hidden = false;
  }

  // iPhone ad hoc
  var cadastro = document.getElementById('link-cadastro');
  var ipa = document.getElementById('link-ipa');
  if (config.urlCadastroUdid) {
    cadastro.href = config.urlCadastroUdid.replace(/\/$/, '') + '/perfil';
  } else {
    cadastro.classList.add('desabilitado');
    cadastro.removeAttribute('href');
    cadastro.textContent = '1. Cadastro de iPhones ainda não configurado';
  }
  if (config.ipa) {
    var manifesto = new URL('downloads/manifest.plist', location.href).href;
    ipa.href = 'itms-services://?action=download-manifest&url=' + encodeURIComponent(manifesto);
  } else {
    ipa.classList.add('desabilitado');
    ipa.removeAttribute('href');
    ipa.textContent = '2. App iOS ainda não publicado';
  }
  if (/cadastro=ok/.test(location.search)) {
    var aviso = document.createElement('p');
    aviso.className = 'aviso';
    aviso.textContent = 'iPhone cadastrado. Um novo build foi pedido: em alguns minutos, toque em "Instalar o app".';
    document.getElementById('opcao-ios').prepend(aviso);
  }

  // Rede local
  var campo = document.getElementById('endereco');
  document.querySelectorAll('button.endereco').forEach(function (b) {
    b.addEventListener('click', function () {
      campo.value = b.textContent;
      campo.focus();
    });
  });
  document.getElementById('entrar-rede').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var alvo = campo.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!alvo) return;
    if (alvo.indexOf(':') < 0) alvo += ':8080';
    location.href = 'http://' + alvo + '/';
  });

  var versao = document.getElementById('versao');
  if (config.versao) versao.textContent = 'Versão ' + config.versao + (config.data ? ', publicada em ' + config.data : '') + '.';
})();
