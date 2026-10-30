import {expect,test} from "vitest";
import {corrigirCp850,pareceCp850} from "@/lib/importacao/encoding";
test("cp850",()=>{
 for (const [a,b] of [["BG MATERIAIS DE CONSTRU€ÇO LTDA","BG MATERIAIS DE CONSTRUÇÃO LTDA"],["MECATEX REPRESENTA€åES","MECATEX REPRESENTAÇÕES"],["Lucca Video Com‚rcio","Lucca Video Comércio"],["ASSOCIA€ÇO LITERµRIA SÇO","ASSOCIAÇÃO LITERÁRIA SÃO"]]) {expect(pareceCp850(a)).toBe(true);expect(corrigirCp850(a)).toBe(b);}
 expect(pareceCp850("CONSTRUÇÃO")).toBe(false);
});
