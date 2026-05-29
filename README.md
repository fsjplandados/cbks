# Mapa Antifraude — Dashboard & Pipeline de Conciliação de Chargebacks

Este projeto foi desenvolvido para unificar, cruzar e analisar dados de chargebacks (contestações de compra) e notificações de fraude de três fontes distintas do ecossistema das **Farmácias São João**: **Adyen**, **SAP** e **ClearSale**, enriquecidos com informações logísticas e comerciais da **API da VTEX**.

O objetivo principal é fornecer à equipe de Prevenção de Fraudes e Controladoria uma visão consolidada de onde estão os ofensores, quais modalidades de entrega são mais afetadas e qual o status de conciliação financeira das transações.

---

## 📋 Resumo das Fontes de Dados

Para entender o processo, primeiro mapeamos o que cada sistema entrega ao pipeline:

| Fonte de Dados | O que ela representa | Formato | Informações Cruciais Extraídas |
| :--- | :--- | :--- | :--- |
| **Adyen** (Adquirente) | Transações e contestações originais do cartão de crédito. É a nossa base de verdade. | 17 CSVs mensais (2025-2026) | `PSP Reference` (ID único da transação), Tipo (`Chargeback` ou `NotificationOfChargeback`), Valor, Bandeira, E-mail do comprador, Metadados (ID do Pedido VTEX). |
| **SAP** (ERP Contábil) | Registro contábil das perdas. Identifica o que foi lançado financeiramente. | 2 Planilhas Excel (`.xlsx`) | Denominação de Cobrança (contendo o PSP contábil ou NSU), Valor lançado, Filial/Centro de Custo contábil. |
| **ClearSale** (Antifraude) | Análise de risco e score de fraude aplicada na hora da compra. | 2 Relatórios em HTML/Excel | ID do Pedido original, Score de risco, Status final do antifraude, Itens comprados (Tipo de produto), Cidade e UF de entrega. |

---

## ⚙️ Como Funciona o Processamento dos Dados (`process_data.py`)

O script Python `process_data.py` é o "cérebro" do pipeline. Ele foi desenhado para ser executado periodicamente ou sob demanda. Abaixo, explicamos em termos simples (de negócio) as etapas que ele realiza para consolidar os dados:

### Etapa 1: Leitura e Filtro Inteligente
O script abre todos os relatórios brutos das 3 fontes. Ele descarta linhas duplicadas e filtra apenas o que realmente importa:
- Na **Adyen**, separa o que é **Chargeback** (já confirmado) e o que é **NOC** (*Notification of Chargeback* — o alerta prévio de que uma contestação vai acontecer).
- No **SAP**, filtra os registros contábeis marcados com a operação "CHARGEBACK".
- Na **ClearSale**, remove cabeçalhos corrompidos e padroniza as colunas de pedidos.

### Etapa 2: O Cruzamento dos Dados (Reconciliação)
Para sabermos se um chargeback da Adyen está devidamente contabilizado e analisado pelo antifraude, o robô faz dois cruzamentos cruciais:
1. **Adyen ↔ SAP (Conciliação Contábil):** O robô procura o número de `PSP Reference` da Adyen dentro do campo de histórico/denominação do SAP. Se achar, significa que o financeiro lançou a perda corretamente no ERP (**Match SAP = Sim**). *Hoje, temos um índice excelente de ~96% de match contábil.*
2. **Adyen ↔ ClearSale (Análise Antifraude):** O robô extrai o ID do Pedido VTEX que fica escondido dentro do campo de metadados da Adyen. Ele então procura esse ID dentro da ClearSale (fazendo uma limpeza nos hifens e UUIDs). Se achar, vincula o score de risco e os itens comprados àquele chargeback (**Match ClearSale = Sim**).

### Etapa 3: Identificação do Alerta NOC → Chargeback
Uma Notificação de Chargeback (NOC) é como um "aviso prévio" enviado pelo banco emissor. O robô faz uma varredura temporal para verificar:
> *"Esse número de PSP que recebemos como alerta (NOC) no dia X, virou um Chargeback confirmado no dia Y?"*
Se sim, ele marca esse registro como **"Noc que virou Chargeback"**. Isso nos dá a **Taxa de Conversão de Alertas** (atualmente em ~89.5%), provando que um alerta NOC quase sempre se torna uma perda definitiva se não for tratado.

### Etapa 4: Enriquecimento via API da VTEX (Logística e Lojas)
Muitos dados vitais (como a loja física onde o cliente retirou o produto ou a forma de entrega) não constam nos relatórios financeiros.
Para resolver isso, o robô conecta-se diretamente à **API da VTEX** utilizando chaves seguras e, de forma extremamente veloz (em paralelo), busca os dados reais da compra para cada ID de Pedido:
- Classifica a entrega em **Clique e Retire** (retirada física) ou **Entrega em Casa**.
- Identifica o nome exato da **Loja/Filial** física envolvida.
- Identifica as **Categorias do VTEX** dos produtos comprados.

---

## 📦 Saídas Geradas (Os Resultados)

Ao final da execução do `process_data.py`, o pipeline exporta duas saídas fundamentais:

### 1. Planilha Contábil Consolidada (`consolidado_chargeback.xlsx`)
Um arquivo Excel premium e limpo, pronto para auditoria interna, contendo 5 abas organizadas:
1. **Consolidado:** Todos os registros unificados (Adyen + SAP + ClearSale + VTEX).
2. **Chargebacks:** Apenas as contestações confirmadas.
3. **Notifications (NOCs):** Apenas os alertas prévios.
4. **NOCs que viraram CB:** A lista exata de alertas que de fato geraram prejuízo financeiro.
5. **Resumo Mensal:** Tabela dinâmica resumindo a quantidade e o valor de perdas mês a mês.

### 2. Base de Dados do Painel (`dashboard_raw.json`)
Um arquivo contendo a estrutura de dados consolidada e otimizada (sem valores nulos ou inválidos) que o painel web utiliza para alimentar os gráficos em tempo real.

---

## 📊 O Dashboard Interativo (`painel.html`)

O dashboard é uma interface web moderna, em *Dark Mode*, que roda localmente no navegador servido por um servidor HTTP simples. Ele foi migrado para a tecnologia **ApexCharts (SVG Vetorial)** para garantir que 100% dos gráficos desenhem suas formas de maneira impecável em qualquer computador, sem depender de aceleração por hardware ou placas de vídeo do usuário.

### Recursos do Dashboard:
- **KPI Cards Rápidos:** Indicam valores e quantidades consolidadas, ticket médio e a taxa de conversão NOC → CB.
- **Filtro Temporal Dinâmico:** Você pode selecionar o período (ex: de Janeiro/2025 a Maio/2026) e toda a página se recalcula em menos de 1 segundo (agregação client-side ultra veloz).
- **Indicador de Entrega:** Mostra o volume de fraudes/disputas que ocorrem no *Clique e Retire* versus *Entrega em Casa*.
- **Top Ofensores:** Gráficos e tabelas listando as Lojas mais afetadas, Tipos de Produto mais visados (ex: Fraldas, Leites Infantis) e os E-mails recorrentes com mais incidentes.
- **Auditoria de Cross-Validation:** Área dedicada a mostrar visualmente a taxa de cobertura entre SAP, Adyen e ClearSale.

---

## 🚀 Como Executar o Projeto Localmente

### Pré-requisitos
Ter o **Python 3** instalado em sua máquina.

### Passo 1: Executar o Pipeline de Dados (Sempre que atualizar os CSVs/Excel)
Coloque os novos arquivos brutos em suas respectivas pastas e execute no terminal:
```bash
python process_data.py
```
Isso atualizará a planilha Excel `consolidado_chargeback.xlsx` e os dados do dashboard em tempo real.

### Passo 2: Iniciar o Servidor do Dashboard
Na pasta raiz do projeto, execute o comando para abrir o servidor web local:
```bash
python -m http.server 8080 --directory dashboard
```

### Passo 3: Visualizar no Navegador
Abra o seu navegador de preferência e acesse:
```text
http://localhost:8080/painel.html
```
*Dica: Caso atualize o código ou os dados e não veja as mudanças imediatas, limpe o cache pressionando `Ctrl + F5` (ou `Cmd + Shift + R` no Mac).*
