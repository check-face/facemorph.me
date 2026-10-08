export function latent(i,n){const v=new Float32Array(9216);for(let k=0;k<9216;k++)v[k]=Math.sin(k*0.37+i/n*3)*0.8;return v;}
