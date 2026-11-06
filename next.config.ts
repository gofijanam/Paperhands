import type {NextConfig} from 'next';
const config:NextConfig={reactStrictMode:true,poweredByHeader:false,output:'standalone',serverExternalPackages:['node:sqlite'],experimental:{cpus:2}};
export default config;
