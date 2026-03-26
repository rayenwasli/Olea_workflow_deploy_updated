import axios from 'axios';

export const http = axios.create({
  baseURL: '/api',
});

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('scan.token') ?? sessionStorage.getItem('scan.token');
  if (token) {
    config.headers = config.headers ?? {};
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

