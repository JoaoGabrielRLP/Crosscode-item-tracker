# CrossCode Item Tracker

Mod para CrossCode que permite acompanhar os materiais necessários para criar
equipamentos e outros itens negociados com NPCs.

Repositório: <https://github.com/JoaoGabrielRLP/Crosscode-item-tracker>

## Funcionalidades

- Adiciona o botão `Track` aos menus de troca/criação de itens.
- Cria uma lista automaticamente a partir dos materiais necessários da oferta
	selecionada.
- Permite manter várias listas salvas.
- Impede listas duplicadas para o mesmo item produzido.
- Mostra apenas listas não finalizadas na aba `Listas` do menu de missões.
- Mantém listas concluídas no histórico interno.
- Permite excluir uma lista pelo botão `DELETE`.
- Permite selecionar uma lista no menu de missões e torná-la a lista exibida no
	HUD pelo botão `Track`.
- Exibe no HUD apenas uma lista por vez.
- Permite alternar entre as listas ativas usando a tecla `L`.
- Ao pressionar `L` repetidamente, o HUD passa para a próxima lista; depois da
	última lista, ele desaparece.
- Atualiza as quantidades dos materiais conforme o jogador coleta itens.
- Move automaticamente listas completas para o histórico.
- Permite clicar diretamente na linha de um material que o jogador já possui
	para consultar onde obtê-lo.
- Exibe nomes localizados de criaturas, plantas e áreas usando os dados do jogo.
- Mostra uma imagem da criatura ou da planta na janela de informações.
- Usa o sprite completo e frontal das criaturas através do componente nativo do
	Almanaque Monstro.
- Funciona sem alterar o arquivo de save do CrossCode.

## Como usar

1. Fale com um NPC que possua uma oferta de troca ou criação.
2. Selecione o item que deseja criar.
3. Pressione `Track` para criar ou atualizar a lista daquele item.
4. Abra o menu de missões e selecione a aba `Listas`.
5. Selecione uma lista para ver seus materiais no painel esquerdo.
6. Use `Track` para exibir essa lista no HUD.
7. Pressione `L` para alternar entre as listas ativas.

Quando o jogador já possui parte de um material, a linha correspondente pode
ser selecionada para abrir uma janela com as fontes conhecidas, como criaturas,
plantas, comerciantes e áreas do jogo.

## HUD

O HUD aparece no canto superior direito e mostra:

- O nome do item que está sendo acompanhado.
- Cada material necessário.
- A quantidade atual e a quantidade necessária.
- Um indicador visual quando o material já foi obtido.

O HUD mostra somente a lista ativa. A tecla `L` controla a troca entre listas e
a visibilidade do HUD.

## Armazenamento

As listas são armazenadas no `localStorage` usando uma chave exclusiva do mod:

```text
crosscode-item-tracker.lists
```

O armazenamento é separado do save do jogo. Ele contém as listas, a lista
ativa, o estado de visibilidade do HUD e o histórico de listas concluídas.

## Instalação

1. Instale o CCLoader compatível com a versão do CrossCode.
2. Copie a pasta `item-tracker` para:

```text
CrossCode/assets/mods/
```

3. Inicie o jogo pelo CCLoader.

## Compatibilidade

O mod foi desenvolvido para o ambiente CCLoader 2 e depende dos módulos do
CrossCode usados pelos menus de troca, missões e Almanaque Monstro.

As informações de origem dependem dos dados disponíveis no banco do jogo. Se
uma criatura, planta ou área não possuir uma entrada correspondente, o mod usa
o identificador original como fallback.