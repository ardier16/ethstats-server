'use strict';

/* Init Angular App */
const netStatsApp = angular.module('netStatsApp', ['netStatsApp.filters', 'netStatsApp.directives', 'ngStorage']);

netStatsApp.run(function ($rootScope) {
  $rootScope.networkName = networkName || 'Ethereum';
  $rootScope.faviconPath = faviconPath || '/favicon.ico';
});

/* Services */

netStatsApp.factory('socket', function ($rootScope) {
  const socket = new Primus('ws://localhost:3000/primus');
  return socket;
});

netStatsApp.factory('toastr', function ($rootScope) {
  toastr = window.toastr;
  toastr.options = {
    closeButton: false,
    debug: false,
    progressBar: false,
    newestOnTop: true,
    positionClass: 'toast-top-right',
    preventDuplicates: false,
    onclick: null,
    showDuration: '300',
    hideDuration: '1000',
    timeOut: '5000',
    extendedTimeOut: '1000',
    showEasing: 'swing',
    hideEasing: 'linear',
    showMethod: 'fadeIn',
    hideMethod: 'fadeOut'
  };
  return toastr;
});

netStatsApp.factory('_', function ($rootScope) {
  const lodash = window._;
  return lodash;
});
