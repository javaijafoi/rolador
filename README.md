# Rolador

Rolador de dados para RPG de mesa com cara de PICO-8. Escolhe o "cartucho" do sistema, ajusta os números e rola.

## Sistemas

| Cartucho | Sistema | O que faz |
| --- | --- | --- |
| LIVRE | Qualquer um | Notação completa (veja abaixo), atalhos de dados e média/mín/máx |
| D20 | D&D 5e, Tormenta20, Pathfinder | d20 + mod contra CD, vantagem/desvantagem, 20 e 1 naturais |
| FATE | Fate Core, #iHunt | 4dF + perícia + invocações, escada Fate e tensões |
| PBTA | Apocalypse World, Dungeon World... | 2d6 + atributo, faixas 10+ / 7–9 / 6- |
| D100 | Chamado de Cthulhu 7e | d100 com dados de bônus/penalidade, regular/difícil/extremo/desastre |
| V5 | Vampiro: A Máscara 5ª ed. | Parada de d10 com dados de Fome, pares de 10, crítico bagunçado, falha bestial |
| WOD | Storyteller clássico | Parada de d10 contra dificuldade, 1 anula sucesso, especialização |
| SR | Shadowrun 5e/6e | Parada de d6, acertos em 5–6, glitch, regra do 6 |
| SWADE | Savage Worlds | Dado de característica + dado selvagem, explosões, ampliações, olhos de cobra |
| BLADES | Blades in the Dark | Pega o maior d6, crítico com dois 6, parada zero |
| DUALITY | Daggerheart | d12 de Esperança + d12 de Medo, vantagem em d6 |
| 3D6 | GURPS | 3d6 abaixo do NH com sucesso decisivo e falha crítica |

## Notação livre

- `2d6+3`, `1d8-1d4-2`: soma e subtrai parcelas
- `4d6kh3` mantém os 3 maiores, `kl` os menores, `dl1`/`dh1` descartam
- `2d20kh1` vantagem, `2d20kl1` desvantagem
- `3d6!` explode no máximo, `1d6!!` explosão somada
- `1d20r1`, `4d6r<3` rerrola
- `8d10>=7` conta sucessos
- `d%` é d100, `4dF` são dados Fate

O link da página guarda a última rolagem livre (`/#4d6kh3`), então dá para mandar para a mesa.

## Detalhes

- Aleatoriedade via `crypto.getRandomValues`, sem viés de módulo.
- Histórico, sistema escolhido e valores ficam só no `localStorage` do navegador. Não há backend.
- Sons chiptune gerados com WebAudio.

## Rodando

```sh
npm install
npm run dev
npm test
npm run build
```

Começou como um fork do [dice-roller do SeanMcP](https://github.com/SeanMcP/dice-roller); esta versão foi reescrita do zero.
