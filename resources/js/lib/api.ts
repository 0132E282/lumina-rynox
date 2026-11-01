import axios from 'axios';
import { xsrfToken } from '@/lib/xsrf';

/** * Axios instance for the admin `/items` API with the XSRF token and JSON headers. */
export const api = axios.create({
    headers: {
        Accept: 'application/json',
    },
});

api.interceptors.request.use((config) => {
    config.headers['X-XSRF-TOKEN'] = xsrfToken();

    return config;
});
